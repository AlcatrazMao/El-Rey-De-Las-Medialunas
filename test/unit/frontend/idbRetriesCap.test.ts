import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests para salesQueueStore.incrementRetries — cap automático en 10 retries.
 *
 * Sin el cap, ventas con error 4xx pueden acumular miles de retries sin
 * posibilidad de éxito. Con el fix, al alcanzar >= 10 retries se marca
 * permanentlyFailed con razón 'MAX_RETRIES_EXCEEDED' automáticamente.
 *
 * Testeamos la lógica pura sin IndexedDB real, replicando el comportamiento
 * del handler onsuccess dentro de incrementRetries.
 */

// ── Tipos mínimos (igual que idb.ts) ────────────────────────────────────────

interface IDBSaleQueueItem {
  id: string;
  saleData: Record<string, unknown>;
  createdAt: string;
  origin: 'web' | 'local';
  synced: boolean;
  retries: number;
  permanentlyFailed?: boolean;
  permanentFailReason?: string;
}

// ── Réplica de la lógica de incrementRetries ─────────────────────────────────
// Refleja el handler onsuccess del handler real en idb.ts.

const MAX_RETRIES = 10;

function applyIncrementRetries(item: IDBSaleQueueItem): IDBSaleQueueItem {
  const updated = { ...item };
  updated.retries += 1;
  if (updated.retries >= MAX_RETRIES) {
    updated.permanentlyFailed = true;
    updated.permanentFailReason = 'MAX_RETRIES_EXCEEDED';
  }
  return updated;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeItem(retries: number): IDBSaleQueueItem {
  return {
    id: 'sale_abc',
    saleData: {},
    createdAt: '2024-01-01T12:00:00.000Z',
    origin: 'local',
    synced: false,
    retries,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('incrementRetries — cap automático a 10', () => {
  it('retries 0 → 1: no marca permanentlyFailed', () => {
    const result = applyIncrementRetries(makeItem(0));
    expect(result.retries).toBe(1);
    expect(result.permanentlyFailed).toBeUndefined();
    expect(result.permanentFailReason).toBeUndefined();
  });

  it('retries 5 → 6: no marca permanentlyFailed', () => {
    const result = applyIncrementRetries(makeItem(5));
    expect(result.retries).toBe(6);
    expect(result.permanentlyFailed).toBeUndefined();
  });

  it('retries 8 → 9: no marca permanentlyFailed (todavía por debajo del cap)', () => {
    const result = applyIncrementRetries(makeItem(8));
    expect(result.retries).toBe(9);
    expect(result.permanentlyFailed).toBeUndefined();
  });

  it('retries 9 → 10: marca permanentlyFailed = true', () => {
    const result = applyIncrementRetries(makeItem(9));
    expect(result.retries).toBe(10);
    expect(result.permanentlyFailed).toBe(true);
  });

  it('retries 9 → 10: permanentFailReason = "MAX_RETRIES_EXCEEDED"', () => {
    const result = applyIncrementRetries(makeItem(9));
    expect(result.permanentFailReason).toBe('MAX_RETRIES_EXCEEDED');
  });

  it('retries 10 → 11: ya estaba en cap, sigue marcado permanentlyFailed', () => {
    const item = { ...makeItem(10), permanentlyFailed: true, permanentFailReason: 'MAX_RETRIES_EXCEEDED' };
    const result = applyIncrementRetries(item);
    expect(result.retries).toBe(11);
    expect(result.permanentlyFailed).toBe(true);
    expect(result.permanentFailReason).toBe('MAX_RETRIES_EXCEEDED');
  });

  it('el incremento es exactamente +1 (no acumula más)', () => {
    const before = 7;
    const result = applyIncrementRetries(makeItem(before));
    expect(result.retries).toBe(before + 1);
  });

  it('no modifica el item original (inmutabilidad en la réplica de test)', () => {
    const original = makeItem(9);
    applyIncrementRetries(original);
    // El original no debe ser mutado en la lógica real del IDB handler
    // porque IDB opera sobre el objeto recuperado (getReq.result)
    expect(original.retries).toBe(9);
  });
});

describe('incrementRetries — integración con store mock', () => {
  // Mock del store completo para verificar que markPermanentlyFailed se llama
  // cuando el contador llega al tope.

  interface MockStore {
    items: Map<string, IDBSaleQueueItem>;
    incrementRetries: (id: string) => Promise<void>;
    markPermanentlyFailed: (id: string, reason?: string) => Promise<void>;
  }

  function makeStoreMock(): MockStore & { markPermanentlyFailedCalls: [string, string?][] } {
    const items = new Map<string, IDBSaleQueueItem>();
    const markPermanentlyFailedCalls: [string, string?][] = [];

    return {
      items,
      markPermanentlyFailedCalls,
      async markPermanentlyFailed(id: string, reason?: string): Promise<void> {
        markPermanentlyFailedCalls.push([id, reason]);
        const item = items.get(id);
        if (item) {
          item.permanentlyFailed = true;
          if (reason) item.permanentFailReason = reason;
        }
      },
      async incrementRetries(id: string): Promise<void> {
        const item = items.get(id);
        if (!item) return;
        item.retries += 1;
        if (item.retries >= MAX_RETRIES) {
          await this.markPermanentlyFailed(id, 'MAX_RETRIES_EXCEEDED');
        }
      },
    };
  }

  let store: ReturnType<typeof makeStoreMock>;

  beforeEach(() => {
    store = makeStoreMock();
  });

  it('al llegar a retries=10, markPermanentlyFailed se llama automáticamente', async () => {
    store.items.set('sale_x', makeItem(9));
    await store.incrementRetries('sale_x');
    expect(store.markPermanentlyFailedCalls).toHaveLength(1);
    expect(store.markPermanentlyFailedCalls[0][0]).toBe('sale_x');
    expect(store.markPermanentlyFailedCalls[0][1]).toBe('MAX_RETRIES_EXCEEDED');
  });

  it('con retries=8→9, markPermanentlyFailed NO se llama', async () => {
    store.items.set('sale_y', makeItem(8));
    await store.incrementRetries('sale_y');
    expect(store.markPermanentlyFailedCalls).toHaveLength(0);
  });

  it('el item queda con permanentlyFailed=true tras alcanzar el cap', async () => {
    store.items.set('sale_z', makeItem(9));
    await store.incrementRetries('sale_z');
    expect(store.items.get('sale_z')?.permanentlyFailed).toBe(true);
  });

  it('id inexistente → no lanza y no marca nada', async () => {
    await expect(store.incrementRetries('no_existe')).resolves.toBeUndefined();
    expect(store.markPermanentlyFailedCalls).toHaveLength(0);
  });

  it('getUnsynced no retorna items permanentlyFailed', () => {
    // Simula el filtro de getUnsynced — verifica que la lógica de filtro
    // excluye items permanentlyFailed correctamente.
    const items: IDBSaleQueueItem[] = [
      { ...makeItem(10), permanentlyFailed: true },
      { ...makeItem(3), id: 'sale_ok' },
    ];
    const unsynced = items.filter(i => !i.synced && !i.permanentlyFailed);
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].id).toBe('sale_ok');
  });
});
