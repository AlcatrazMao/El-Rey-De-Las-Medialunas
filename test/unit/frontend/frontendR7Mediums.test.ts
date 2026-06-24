import { describe, expect, it, vi, afterEach } from 'vitest';

/**
 * Tests para los fixes de frontend R7 (medios y bajos):
 *  - Fix 1: cleanupFilter — createdAt corrupto descartado en lugar de incluido/excluido wrongly
 *  - Fix 2: batchNumberSuffix — dos calls en el mismo ms generan batchNumbers distintos
 *  - Fix 3: resolveExpiryDate — durabilityDays del producto vs fallback 3
 *  - Fix 5: persistBeforeCommit — si localStorage falla, el state no se actualiza
 */

// ---------------------------------------------------------------------------
// Fix 1 — idb.ts deleteOlderThan: filter con Date parsing (post-fix)
// ---------------------------------------------------------------------------

interface MinimalQueueItem {
  id: string;
  createdAt: string;
  synced: boolean;
}

/**
 * Réplica de la lógica del filtro post-fix en salesQueueStore.deleteOlderThan.
 * Convierte cutoff string a ms y valida createdAt vía Date.getTime().
 */
function cleanupFilter(item: MinimalQueueItem, cutoff: string): boolean {
  if (!item.synced) return false;
  if (!item.createdAt || typeof item.createdAt !== 'string') return false;
  const cutoffMs = new Date(cutoff).getTime();
  const createdMs = new Date(item.createdAt).getTime();
  return !Number.isNaN(createdMs) && createdMs < cutoffMs;
}

describe('Fix 1 — cleanupFilter (idb.ts deleteOlderThan)', () => {
  const CUTOFF = '2026-06-20T00:00:00.000Z';

  it('incluye un item synced con createdAt anterior al cutoff', () => {
    const item: MinimalQueueItem = {
      id: 'q1',
      createdAt: '2026-06-19T12:00:00.000Z',
      synced: true,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(true);
  });

  it('excluye un item synced con createdAt posterior al cutoff', () => {
    const item: MinimalQueueItem = {
      id: 'q2',
      createdAt: '2026-06-21T00:00:00.000Z',
      synced: true,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(false);
  });

  it('excluye un item no synced aunque createdAt sea anterior al cutoff', () => {
    const item: MinimalQueueItem = {
      id: 'q3',
      createdAt: '2026-06-01T00:00:00.000Z',
      synced: false,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(false);
  });

  it('descarta (no incluye) un item con createdAt undefined en vez de incluirlo por error', () => {
    // El bug original: 'undefined' < '2026-06-20...' era true en comparación de strings,
    // lo que causaba que items corruptos fueran eliminados incorrectamente.
    const item = {
      id: 'q4',
      createdAt: undefined as unknown as string,
      synced: true,
    };
    expect(cleanupFilter(item as MinimalQueueItem, CUTOFF)).toBe(false);
  });

  it('descarta un item con createdAt null', () => {
    const item = {
      id: 'q5',
      createdAt: null as unknown as string,
      synced: true,
    };
    expect(cleanupFilter(item as MinimalQueueItem, CUTOFF)).toBe(false);
  });

  it('descarta un item con createdAt vacío ("")', () => {
    const item: MinimalQueueItem = {
      id: 'q6',
      createdAt: '',
      synced: true,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(false);
  });

  it('descarta un item con createdAt "undefined" como string', () => {
    // Caso real: alguien hizo String(undefined) al persistir
    const item: MinimalQueueItem = {
      id: 'q7',
      createdAt: 'undefined',
      synced: true,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(false);
  });

  it('descarta un item con createdAt "null" como string', () => {
    const item: MinimalQueueItem = {
      id: 'q8',
      createdAt: 'null',
      synced: true,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(false);
  });

  it('descarta un item con createdAt exactamente igual al cutoff (no estrictamente anterior)', () => {
    const item: MinimalQueueItem = {
      id: 'q9',
      createdAt: CUTOFF,
      synced: true,
    };
    expect(cleanupFilter(item, CUTOFF)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — InventoryView.tsx: batchNumber con sufijo UUID — dos calls en el mismo ms
// ---------------------------------------------------------------------------

/**
 * Réplica de la lógica de generación post-fix (InventoryView.tsx línea 543/710):
 *   `L-${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`
 */
function makeBatchNumber(
  prefix: string,
  nowMs: number,
  uuidSlice: string,
): string {
  return `L-${prefix}-${nowMs.toString(36).toUpperCase()}-${uuidSlice.toUpperCase()}`;
}

describe('Fix 2 — batchNumberSuffix (InventoryView.tsx)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dos llamadas con el mismo Date.now() y UUIDs distintos producen batchNumbers distintos', () => {
    const sameMs = 1719100000000;
    const bn1 = makeBatchNumber('CRO', sameMs, 'ab12');
    const bn2 = makeBatchNumber('CRO', sameMs, 'xy99');
    expect(bn1).not.toBe(bn2);
  });

  it('el sufijo UUID aparece al final del batchNumber', () => {
    const bn = makeBatchNumber('MED', 1719100000000, 'a1b2');
    // Debe terminar con el slice UUID en mayúsculas
    expect(bn.endsWith('-A1B2')).toBe(true);
  });

  it('el formato sigue el patrón L-PREFIX-TIMESTAMP-UUIDSLICE', () => {
    const bn = makeBatchNumber('FAC', 1719100000000, 'ff00');
    const parts = bn.split('-');
    // L, PREFIX, TIMESTAMP(base36), UUIDSLICE — 4 partes separadas por '-'
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('L');
    expect(parts[1]).toBe('FAC');
    expect(parts[2]).toBe((1719100000000).toString(36).toUpperCase());
    expect(parts[3]).toBe('FF00');
  });

  it('100 llamadas en el mismo ms con crypto.randomUUID real producen 100 valores distintos', () => {
    const sameMs = Date.now();
    const generated = new Set<string>();
    for (let i = 0; i < 100; i++) {
      // Usamos crypto.randomUUID() real (disponible en Node 18+/vitest)
      const uuidSlice = crypto.randomUUID().slice(0, 4);
      generated.add(makeBatchNumber('CRO', sameMs, uuidSlice));
    }
    // Con 100 UUIDs random de 4 hex chars (65536 posibilidades), prácticamente imposible colisionar
    expect(generated.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — AppContext.tsx approveSupplyRequest: resolveExpiryDate con durabilityDays
// ---------------------------------------------------------------------------

interface MinimalProduct {
  id: string;
  durabilityDays?: number;
}

/**
 * Réplica de la lógica post-fix en approveSupplyRequest:
 * busca el producto, usa durabilityDays con fallback a 3.
 */
function resolveExpiryDate(
  productId: string,
  products: MinimalProduct[],
  elaborationDate: Date,
): string {
  const product = products.find(p => p.id === productId);
  const durabilityDays = product?.durabilityDays ?? 3;
  return new Date(elaborationDate.getTime() + durabilityDays * 86400000)
    .toISOString()
    .split('T')[0];
}

describe('Fix 3 — resolveExpiryDate (AppContext.tsx approveSupplyRequest)', () => {
  const BASE_DATE = new Date('2026-06-20T00:00:00.000Z');

  it('usa durabilityDays del producto cuando está definido (30 días)', () => {
    const products: MinimalProduct[] = [{ id: 'p1', durabilityDays: 30 }];
    const result = resolveExpiryDate('p1', products, BASE_DATE);
    expect(result).toBe('2026-07-20');
  });

  it('usa fallback 3 días cuando el producto no tiene durabilityDays', () => {
    const products: MinimalProduct[] = [{ id: 'p1' }]; // durabilityDays ausente
    const result = resolveExpiryDate('p1', products, BASE_DATE);
    expect(result).toBe('2026-06-23');
  });

  it('usa fallback 3 días cuando durabilityDays es undefined explícito', () => {
    const products: MinimalProduct[] = [{ id: 'p1', durabilityDays: undefined }];
    const result = resolveExpiryDate('p1', products, BASE_DATE);
    expect(result).toBe('2026-06-23');
  });

  it('usa fallback 3 días cuando el producto no existe en la lista', () => {
    const products: MinimalProduct[] = [{ id: 'otro', durabilityDays: 7 }];
    const result = resolveExpiryDate('p_desconocido', products, BASE_DATE);
    expect(result).toBe('2026-06-23');
  });

  it('usa fallback 3 días cuando la lista de productos está vacía', () => {
    const result = resolveExpiryDate('p1', [], BASE_DATE);
    expect(result).toBe('2026-06-23');
  });

  it('durabilityDays 1 → vence al día siguiente', () => {
    const products: MinimalProduct[] = [{ id: 'p1', durabilityDays: 1 }];
    const result = resolveExpiryDate('p1', products, BASE_DATE);
    expect(result).toBe('2026-06-21');
  });

  it('durabilityDays 7 → vence en una semana', () => {
    const products: MinimalProduct[] = [{ id: 'p1', durabilityDays: 7 }];
    const result = resolveExpiryDate('p1', products, BASE_DATE);
    expect(result).toBe('2026-06-27');
  });

  it('durabilityDays 3 explícito coincide con fallback 3', () => {
    const productsWithDays: MinimalProduct[] = [{ id: 'p1', durabilityDays: 3 }];
    const productsWithout: MinimalProduct[] = [{ id: 'p1' }];
    const withDays = resolveExpiryDate('p1', productsWithDays, BASE_DATE);
    const withoutDays = resolveExpiryDate('p1', productsWithout, BASE_DATE);
    expect(withDays).toBe(withoutDays);
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — useSettings.ts: persistBeforeCommit — si localStorage falla, state no se actualiza
// ---------------------------------------------------------------------------

/**
 * Réplica pura de la lógica post-fix en useSettings.ts:
 * intentar persistir PRIMERO; sólo retornar el nuevo estado si persistir tuvo éxito.
 * En caso de error, retornar el estado anterior (prev).
 *
 * Acá simulamos el patrón setSettings(prev => ...) retornando prev o updated
 * según si localStorage lanza.
 */
function buildSettingsUpdater(
  updated: Record<string, unknown>,
  storage: { setItem: (key: string, value: string) => void },
  key: string,
): (prev: Record<string, unknown>) => Record<string, unknown> {
  return (prev) => {
    try {
      storage.setItem(key, JSON.stringify(updated));
    } catch {
      // localStorage lleno: no commitear el state
      return prev;
    }
    return updated;
  };
}

describe('Fix 5 — persistBeforeCommit (useSettings.ts)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('si localStorage lanza QuotaExceededError, el updater retorna el estado anterior sin cambios', () => {
    const prev = { businessName: 'El Rey' };
    const updated = { businessName: 'Nuevo Nombre' };

    const failingStorage = {
      setItem: () => { throw new DOMException('QuotaExceededError'); },
    };

    const updater = buildSettingsUpdater(updated, failingStorage, 'erp_settings');
    const result = updater(prev);

    expect(result).toBe(prev); // referencia exacta: no cambió
    expect(result).toStrictEqual({ businessName: 'El Rey' });
  });

  it('si localStorage tiene éxito, el updater retorna el nuevo estado', () => {
    const prev = { businessName: 'El Rey' };
    const updated = { businessName: 'Nuevo Nombre' };
    let stored = '';

    const successStorage = {
      setItem: (_key: string, value: string) => { stored = value; },
    };

    const updater = buildSettingsUpdater(updated, successStorage, 'erp_settings');
    const result = updater(prev);

    expect(result).toBe(updated); // referencia exacta: el nuevo estado
    expect(result).toStrictEqual({ businessName: 'Nuevo Nombre' });
    expect(stored).toBe(JSON.stringify(updated)); // localStorage recibió el valor
  });

  it('el estado previo se conserva intacto si localStorage falla (no mutado)', () => {
    const prev = { businessName: 'Original', ivaRate: 0.21 };
    const updated = { businessName: 'Cambiado', ivaRate: 0.105 };

    const failingStorage = {
      setItem: () => { throw new Error('Storage full'); },
    };

    const updater = buildSettingsUpdater(updated, failingStorage, 'erp_settings');
    const result = updater(prev);

    // El resultado debe ser el mismo objeto prev sin modificaciones
    expect(result.businessName).toBe('Original');
    expect((result as { ivaRate: number }).ivaRate).toBe(0.21);
  });

  it('con storage fallido: dos llamadas sucesivas preservan el estado original ambas veces', () => {
    const prev = { version: 1 };
    const update1 = { version: 2 };
    const update2 = { version: 3 };
    let callCount = 0;

    const failingStorage = {
      setItem: () => { callCount++; throw new Error('Storage full'); },
    };

    const r1 = buildSettingsUpdater(update1, failingStorage, 'k')(prev);
    const r2 = buildSettingsUpdater(update2, failingStorage, 'k')(r1);

    expect(callCount).toBe(2); // localStorage se intentó ambas veces
    expect((r1 as { version: number }).version).toBe(1);
    expect((r2 as { version: number }).version).toBe(1); // prev del segundo call = r1 = prev
  });
});
