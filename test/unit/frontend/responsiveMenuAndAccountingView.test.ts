import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(resolve('apps/pos-pc/package.json'));
const { createElement, act } = require('react');
const { createRoot } = require('react-dom/client');

const mockState = vi.hoisted(() => {
  const sampleSales = [
    {
      id: 's-1',
      invoiceNumber: 'T-100',
      documentNumber: 100,
      documentType: 'ticket' as const,
      date: '2026-10-24T12:00:00Z',
      items: [{ productId: 'p1', name: 'Medialunas', quantity: 12, price: 500, subtotal: 6000 }],
      total: 6000,
      tax: 1040,
      subtotal_bruto: 6000,
      discount_total: 0,
      total_final: 6000,
      idempotencyKey: 'k-1',
      paymentMethod: 'efectivo' as const,
      paymentStatus: 'completed' as const,
      operatorRole: 'cajero',
      operatorName: 'Juan',
    },
  ];

  const sampleExpenses = [
    {
      id: 'exp-1',
      concept: 'Bolsas de papel kraft',
      category: 'otros' as const,
      amount: 1500,
      date: '2026-10-24T10:00:00Z',
      paymentMethod: 'Efectivo de Caja Chica',
    },
  ];

  return {
    sales: sampleSales,
    expenses: sampleExpenses,
    addExpense: vi.fn(),
    products: [{ id: 'p1', name: 'Medialunas', cost: 150, price: 500, stock: 100, minStock: 10, image: '🥐', code: 'M1', ingredients: [], category: 'facturas' as const }],
    activeUser: { name: 'Admin User', role: 'admin' as const },
    activeTab: 'accounting',
    setActiveTab: vi.fn(),
    syncStatus: { pending: 0, uploading: false, online: true, isBlocked: false, isSlow: false },
    logout: vi.fn(),
  };
});

vi.mock('../../../apps/pos-pc/src/AppContext', () => ({
  useApp: () => ({
    sales: mockState.sales,
    expenses: mockState.expenses,
    addExpense: mockState.addExpense,
    products: mockState.products,
    activeUser: mockState.activeUser,
    activeTab: mockState.activeTab,
    setActiveTab: mockState.setActiveTab,
    syncStatus: mockState.syncStatus,
    logout: mockState.logout,
    batches: [],
  }),
}));

vi.mock('../../../apps/pos-pc/src/config/firebase', () => ({
  auth: { signOut: vi.fn() },
}));

vi.mock('../../../apps/pos-pc/src/hooks/useVersionCheck', () => ({
  useVersionCheck: () => false,
}));

vi.mock('../../../apps/pos-pc/src/hooks/useSyncEngine', () => ({
  useSyncEngine: () => ({ isOnline: true, isSyncing: false, lastSync: null, syncNow: vi.fn() }),
}));

vi.mock('../../../apps/pos-pc/src/components/SyncLed', () => ({
  SyncLed: () => createElement('div', { id: 'mock-sync-led' }),
}));

vi.mock('../../../apps/pos-pc/src/components/NotificationCenter', () => ({
  NotificationCenter: () => createElement('div', { id: 'mock-notif-center' }),
}));

vi.mock('../../../apps/pos-pc/src/components/transfers/BranchSelector', () => ({
  BranchSelector: () => createElement('div', { id: 'mock-branch-selector' }),
}));

import { AccountingView } from '../../../apps/pos-pc/src/components/AccountingView';
import { ERPLayout } from '../../../apps/pos-pc/src/App';

describe('AccountingView Component: selector de tipo de movimiento e ingresos', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(AccountingView));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renderiza selector de tipo de movimiento y pestañas de filtro (Todos, Ingresos, Egresos)', () => {
    const select = container.querySelector<HTMLSelectElement>('#filter-movement-type');
    expect(select).not.toBeNull();
    expect(select?.value).toBe('todos');

    expect(container.querySelector('#tab-filter-todos')).not.toBeNull();
    expect(container.querySelector('#tab-filter-ingresos')).not.toBeNull();
    expect(container.querySelector('#tab-filter-egresos')).not.toBeNull();
  });

  it('por defecto (Todos) muestra tanto el egreso como la venta con sus indicadores verde y rojo', () => {
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    // Debe contener el badge de Ingreso e indicador positivo
    const ingresoBadge = container.querySelector('tbody .bg-emerald-100');
    expect(ingresoBadge).not.toBeNull();
    expect(ingresoBadge?.textContent).toContain('Ingreso');

    // Debe contener el badge de Egreso e indicador negativo
    const egresoBadge = container.querySelector('tbody .bg-red-100');
    expect(egresoBadge).not.toBeNull();
    expect(egresoBadge?.textContent).toContain('Egreso');

    // Montos con formato verde/rojo
    const greenAmount = container.querySelector('tbody td.text-emerald-600');
    expect(greenAmount).not.toBeNull();
    expect(greenAmount?.textContent).toContain('+');

    const redAmount = container.querySelector('tbody td.text-red-650, tbody td.text-red-400');
    expect(redAmount).not.toBeNull();
    expect(redAmount?.textContent).toContain('-');
  });

  it('al filtrar por Ingresos mediante el selector solo muestra la venta', async () => {
    const select = container.querySelector<HTMLSelectElement>('#filter-movement-type')!;
    await act(async () => {
      select.value = 'ingreso';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Ingreso');
    expect(rows[0].textContent).toContain('Venta Mostrador');
    expect(rows[0].textContent).not.toContain('Bolsas de papel');
  });

  it('al filtrar por Egresos mediante el botón de pestaña solo muestra el egreso', async () => {
    const tabEgresos = container.querySelector<HTMLButtonElement>('#tab-filter-egresos')!;
    await act(async () => {
      tabEgresos.click();
    });

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Egreso');
    expect(rows[0].textContent).toContain('Bolsas de papel');
    expect(rows[0].textContent).not.toContain('Venta Mostrador');
  });
});

describe('ERPLayout: Menú responsivo (abrir con ícono y nombre)', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(ERPLayout));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('el botón de marca móvil contiene el ícono y el nombre, y abre el menú al hacer click', async () => {
    const brandBtn = container.querySelector<HTMLButtonElement>('#btn-mobile-brand-menu');
    expect(brandBtn).not.toBeNull();
    expect(brandBtn?.textContent).toContain('🥐');
    expect(brandBtn?.textContent).toContain('El Rey De Las Medialunas');

    // Inicialmente el menú desplegable mobile está cerrado
    expect(container.querySelector('.grid.grid-cols-2')).toBeNull();

    // Click en el ícono / nombre
    await act(async () => {
      brandBtn?.click();
    });

    // Ahora el menú debe estar abierto
    const mobileMenu = container.querySelector('.grid.grid-cols-2');
    expect(mobileMenu).not.toBeNull();

    // Otro click lo cierra (toggle)
    await act(async () => {
      brandBtn?.click();
    });
    expect(container.querySelector('.grid.grid-cols-2')).toBeNull();
  });

  it('el botón hamburguesa también abre y cierra el menú responsivo', async () => {
    const menuBtn = container.querySelector<HTMLButtonElement>('#btn-mobile-menu-toggle');
    expect(menuBtn).not.toBeNull();

    await act(async () => {
      menuBtn?.click();
    });
    expect(container.querySelector('.grid.grid-cols-2')).not.toBeNull();

    await act(async () => {
      menuBtn?.click();
    });
    expect(container.querySelector('.grid.grid-cols-2')).toBeNull();
  });
});
