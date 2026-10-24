import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(resolve('apps/pos-pc/package.json'));
const { createElement, act } = require('react');
const { createRoot } = require('react-dom/client');

const mockAppContext = vi.hoisted(() => ({
  currentCashSession: {
    id: 'cs-active',
    openedAt: '2026-10-24T08:00:00Z',
    openedBy: 'Cajero Juan',
    initialAmount: 5000,
    expectedAmount: 25000,
    status: 'open' as const,
    note: 'Fondo de cambio inicial',
  },
  cashSessionsHistory: [],
  openCashSession: vi.fn(),
  closeCashSession: vi.fn(),
  closeHistoricalSession: vi.fn(),
  activeUser: { name: 'Juan Perez', role: 'cajero' as const },
  loadMoreSessions: vi.fn(),
  hasMoreSessions: false,
  setActiveTab: vi.fn(),
  isCheckingRemoteSession: false,
}));

vi.mock('../../../apps/pos-pc/src/AppContext', () => ({
  useApp: () => mockAppContext,
}));

vi.mock('../../../apps/pos-pc/src/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      cash: {
        defaultOpeningMode: 'billetes' as const,
        defaultOpeningAmount: 5000,
        defaultOpeningNote: '',
        defaultClosingNote: '',
        denominaciones: [100, 200, 500, 1000, 2000, 10000],
      },
    },
  }),
}));

import { CashSessionView } from '../../../apps/pos-pc/src/components/CashSessionView';

describe('CashSessionView: Flujo asistido de cierre de caja en responsivo', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('muestra botón para abrir otra caja cuando hay sesión activa', async () => {
    await act(async () => {
      root.render(createElement(CashSessionView));
    });

    const openAnotherBtn = container.querySelector<HTMLButtonElement>('#btn-attempt-open-cash');
    expect(openAnotherBtn).not.toBeNull();
    expect(openAnotherBtn?.textContent).toContain('Abrir otra caja');
  });

  it('al intentar abrir otra caja, scrollea suavemente al cierre y resalta con efecto pop', async () => {
    await act(async () => {
      root.render(createElement(CashSessionView));
    });

    const openAnotherBtn = container.querySelector<HTMLButtonElement>('#btn-attempt-open-cash')!;

    await act(async () => {
      openAnotherBtn.click();
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    // Verifica que se aplicó el ring/borde brillante animado al contenedor de cierre
    const closeSection = container.querySelector<HTMLDivElement>('#section-cash-close');
    expect(closeSection?.className).toContain('ring-4');
    expect(closeSection?.className).toContain('border-amber-500');

    // Verifica que el botón de continuar conteo tiene pop y animación
    const proceedBtn = container.querySelector<HTMLButtonElement>('#btn-proceed-to-counting');
    expect(proceedBtn?.className).toContain('animate-pulse');
    expect(proceedBtn?.className).toContain('ring-4');

    // Muestra alerta contextual explicativa
    expect(container.textContent).toContain('Para abrir un nuevo turno, primero debés registrar el conteo físico');
  });

  it('al presionar continuar con el conteo, lleva la vista y enfoca "Usar este monto"', async () => {
    await act(async () => {
      root.render(createElement(CashSessionView));
    });

    const openAnotherBtn = container.querySelector<HTMLButtonElement>('#btn-attempt-open-cash')!;
    await act(async () => {
      openAnotherBtn.click();
    });

    const proceedBtn = container.querySelector<HTMLButtonElement>('#btn-proceed-to-counting')!;

    await act(async () => {
      proceedBtn.click();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    const useAmountBtn = container.querySelector<HTMLButtonElement>('#btn-use-bill-amount');
    expect(useAmountBtn).not.toBeNull();
  });

  it('asistencia en la calculadora de billetes: al ingresar billetes resalta "Usar este monto"', async () => {
    await act(async () => {
      root.render(createElement(CashSessionView));
    });

    // En la columna de billetes sumamos un billete de $10.000
    // Denominación 10000: click en botón +
    const billCards = container.querySelectorAll('.grid.grid-cols-2 .rounded-2xl');
    expect(billCards.length).toBeGreaterThan(0);

    const firstCard = billCards[billCards.length - 1]; // $10000 es la última
    const plusBtn = firstCard.querySelectorAll('button')[1]; // primer botón es -, segundo es +

    await act(async () => {
      plusBtn.click();
    });

    const useAmountBtn = container.querySelector<HTMLButtonElement>('#btn-use-bill-amount')!;
    expect(useAmountBtn.className).toContain('ring-4');
    expect(useAmountBtn.className).toContain('animate-pulse');

    // Al hacer click en "Usar este monto", transfiere a confirmación y scrollea a Cerrar caja
    await act(async () => {
      useAmountBtn.click();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const finalCloseBtn = container.querySelector<HTMLButtonElement>('#btn-close-and-submit-confirmed');
    expect(finalCloseBtn).not.toBeNull();
    expect(finalCloseBtn?.className).toContain('ring-4');
    expect(finalCloseBtn?.className).toContain('animate-pulse');
  });
});
