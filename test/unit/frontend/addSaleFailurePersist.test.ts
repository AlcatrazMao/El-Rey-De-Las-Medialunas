import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests para la lógica de persistencia de errores de sync en addSale.
 *
 * Dos escenarios críticos:
 *
 * 1. syncSaleToD1 falla → se llama syncEnqueueSale (fallback a IDB).
 * 2. syncSaleToD1 falla Y syncEnqueueSale falla → notificación diferente
 *    (VENTA NO GUARDADA), no la de "se reintentará automáticamente".
 *
 * Testeamos la lógica del bloque .catch() de syncSaleToD1 como función pura,
 * sin montar React ni AppContext. Replicamos el handler para poder inyectar
 * mocks controlados, exactamente como hacen los otros tests de la carpeta.
 */

// ── Tipos mínimos ────────────────────────────────────────────────────────────

interface SaleLike {
  id: string;
  invoiceNumber: string;
  total: number;
}

interface NotifCall {
  title: string;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
}

// ── Réplica del bloque catch de syncSaleToD1 ─────────────────────────────────

/**
 * Handler que replica exactamente la lógica del .catch() en AppContext.addSale
 * (Fix 3). Inyectamos las dependencias para poder controlarlas en tests.
 */
async function handleSyncFailure(
  sale: SaleLike,
  deps: {
    enqueueSale: (data: Record<string, unknown>) => Promise<void>;
    addNotification: (title: string, message: string, type: NotifCall['type']) => void;
    markSyncFailed: (saleId: string) => void;
  }
): Promise<{ enqueued: boolean }> {
  const { enqueueSale, addNotification, markSyncFailed } = deps;

  markSyncFailed(sale.id);

  let enqueued = false;
  try {
    await enqueueSale({ id: sale.id, invoiceNumber: sale.invoiceNumber });
    enqueued = true;
  } catch { /* indexeddb lleno o no disponible */ }

  if (enqueued) {
    addNotification(
      '⚠️ Venta no sincronizada',
      'Esta venta no pudo sincronizarse con el servidor. Se reintentará automáticamente.',
      'warning',
    );
  } else {
    addNotification(
      '🚨 VENTA NO GUARDADA EN SERVIDOR',
      `La venta ${sale.invoiceNumber} quedó solo en este dispositivo y NO pudo encolarse para reintento. Anotá el número de factura y contactá soporte.`,
      'error',
    );
  }

  return { enqueued };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSale(overrides: Partial<SaleLike> = {}): SaleLike {
  return {
    id: 'sale_test_001',
    invoiceNumber: 'FC-A-001-0000042',
    total: 1500,
    ...overrides,
  };
}

// ── Suite 1: cuando solo syncSaleToD1 falla ──────────────────────────────────

describe('addSale sync failure — solo D1 falla, IDB disponible', () => {
  let notifications: NotifCall[];
  let markedFailed: string[];
  let enqueuedItems: Record<string, unknown>[];

  beforeEach(() => {
    notifications = [];
    markedFailed = [];
    enqueuedItems = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('se llama syncEnqueueSale cuando syncSaleToD1 falla', async () => {
    const enqueueSale = vi.fn(async (data: Record<string, unknown>) => {
      enqueuedItems.push(data);
    });
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn((id: string) => { markedFailed.push(id); });

    const sale = makeSale();
    await handleSyncFailure(sale, { enqueueSale, addNotification, markSyncFailed });

    expect(enqueueSale).toHaveBeenCalledOnce();
    expect(enqueuedItems[0]).toMatchObject({ id: sale.id, invoiceNumber: sale.invoiceNumber });
  });

  it('la venta se marca como syncFailed', async () => {
    const enqueueSale = vi.fn(async () => {});
    const addNotification = vi.fn();
    const markSyncFailed = vi.fn((id: string) => { markedFailed.push(id); });

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(markSyncFailed).toHaveBeenCalledOnce();
    expect(markedFailed[0]).toBe('sale_test_001');
  });

  it('notificación tipo warning cuando IDB acepta la venta', async () => {
    const enqueueSale = vi.fn(async () => {});
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn();

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('warning');
    expect(notifications[0].message).toContain('reintentará automáticamente');
  });

  it('retorna { enqueued: true } cuando IDB acepta', async () => {
    const result = await handleSyncFailure(makeSale(), {
      enqueueSale: vi.fn(async () => {}),
      addNotification: vi.fn(),
      markSyncFailed: vi.fn(),
    });
    expect(result.enqueued).toBe(true);
  });
});

// ── Suite 2: cuando syncSaleToD1 Y syncEnqueueSale fallan ────────────────────

describe('addSale sync failure — D1 falla + IDB también falla', () => {
  let notifications: NotifCall[];
  let markedFailed: string[];

  beforeEach(() => {
    notifications = [];
    markedFailed = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra notificación de error (no warning) cuando IDB también falla', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn((id: string) => { markedFailed.push(id); });

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('error');
  });

  it('NO muestra "se reintentará automáticamente" cuando IDB falla', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn();

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    const messages = notifications.map(n => n.message);
    expect(messages.some(m => m.includes('reintentará automáticamente'))).toBe(false);
  });

  it('la notificación de error menciona el número de factura', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('IDB unavailable'); });
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn();

    const sale = makeSale({ invoiceNumber: 'FC-A-001-0000099' });
    await handleSyncFailure(sale, { enqueueSale, addNotification, markSyncFailed });

    expect(notifications[0].message).toContain('FC-A-001-0000099');
  });

  it('la notificación de error menciona "contactá soporte"', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('IDB unavailable'); });
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn();

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(notifications[0].message).toContain('soporte');
  });

  it('la venta se marca syncFailed incluso cuando IDB falla', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('IDB unavailable'); });
    const addNotification = vi.fn();
    const markSyncFailed = vi.fn((id: string) => { markedFailed.push(id); });

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(markSyncFailed).toHaveBeenCalledOnce();
    expect(markedFailed[0]).toBe('sale_test_001');
  });

  it('retorna { enqueued: false } cuando IDB falla', async () => {
    const result = await handleSyncFailure(makeSale(), {
      enqueueSale: vi.fn(async () => { throw new Error('IDB unavailable'); }),
      addNotification: vi.fn(),
      markSyncFailed: vi.fn(),
    });
    expect(result.enqueued).toBe(false);
  });

  it('syncEnqueueSale se llama exactamente una vez aunque falle', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('IDB unavailable'); });
    const addNotification = vi.fn();
    const markSyncFailed = vi.fn();

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(enqueueSale).toHaveBeenCalledOnce();
  });

  it('exactamente una notificación emitida (no dos)', async () => {
    const enqueueSale = vi.fn(async () => { throw new Error('IDB unavailable'); });
    const addNotification = vi.fn((title: string, message: string, type: NotifCall['type']) => {
      notifications.push({ title, message, type });
    });
    const markSyncFailed = vi.fn();

    await handleSyncFailure(makeSale(), { enqueueSale, addNotification, markSyncFailed });

    expect(notifications).toHaveLength(1);
  });
});

// ── Suite 3: diferenciación de los dos paths de notificación ─────────────────

describe('addSale sync failure — diferenciación IDB OK vs IDB falla', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notificación es warning cuando IDB acepta y error cuando IDB rechaza', async () => {
    const sale = makeSale();
    const addNotification = vi.fn();
    const markSyncFailed = vi.fn();

    // Path 1: IDB OK
    const enqueueSaleOk = vi.fn(async () => {});
    await handleSyncFailure(sale, { enqueueSale: enqueueSaleOk, addNotification, markSyncFailed });
    const [, , typeOk] = addNotification.mock.calls[0] as [string, string, NotifCall['type']];
    expect(typeOk).toBe('warning');

    addNotification.mockClear();

    // Path 2: IDB falla
    const enqueueSaleFail = vi.fn(async () => { throw new Error('quota'); });
    await handleSyncFailure(sale, { enqueueSale: enqueueSaleFail, addNotification, markSyncFailed });
    const [, , typeFail] = addNotification.mock.calls[0] as [string, string, NotifCall['type']];
    expect(typeFail).toBe('error');
  });
});
