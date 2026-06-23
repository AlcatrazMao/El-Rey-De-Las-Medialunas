import { describe, it, expect } from 'vitest';

/**
 * Tests para la deducción FIFO de lotes (FIFO batch deduction) en addSale.
 *
 * La lógica está extraída como función pura para poder testear sin React/hooks.
 * Cubre correctness, orden FIFO por fecha de vencimiento, estado sold_out,
 * aislamiento entre productos, y regresión N×M contra el algoritmo original.
 */

// ── Tipo mínimo ──────────────────────────────────────────────────────────────

interface Batch {
  id: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  stock: number;
  elaborationDate: string;
  expiryDate: string; // YYYY-MM-DD
  status: 'active' | 'withdrawn' | 'sold_out' | 'expired';
  withdrawalMode: 'manual' | 'automatic';
}

interface CartItem {
  productId: string;
  quantity: number;
}

// ── Implementación optimizada (Map-based, O(N × M log M)) ────────────────────

function deduceBatchesFIFO(batches: Batch[], cartItems: CartItem[]): Batch[] {
  const updatedBatches = [...batches];
  // Build id→index map once, O(M) — avoid repeated findIndex inside the inner loop
  const batchIdxMap = new Map(updatedBatches.map((b, i) => [b.id, i]));
  for (const item of cartItems) {
    let qtyToDeduct = item.quantity;
    const eligible = updatedBatches
      .filter(b => b.productId === item.productId && b.status === 'active' && b.stock > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    for (const targetBatch of eligible) {
      if (qtyToDeduct <= 0) break;
      const idx = batchIdxMap.get(targetBatch.id);
      if (idx === undefined) continue;
      const b = updatedBatches[idx];
      const deduct = Math.min(b.stock, qtyToDeduct);
      qtyToDeduct -= deduct;
      const nextStock = b.stock - deduct;
      updatedBatches[idx] = {
        ...b,
        stock: nextStock,
        status: nextStock === 0 ? ('sold_out' as const) : b.status,
      };
      // Note: batchIdxMap stays valid because idx doesn't change — we only mutate the object at [idx]
    }
  }
  return updatedBatches;
}

// ── Implementación original (findIndex-based, O(N × M²)) — solo para regresión

function deduceBatchesFIFO_original(batches: Batch[], cartItems: CartItem[]): Batch[] {
  const updatedBatches = [...batches];
  for (const item of cartItems) {
    let qtyToDeduct = item.quantity;
    const eligible = updatedBatches
      .filter(b => b.productId === item.productId && b.status === 'active' && b.stock > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    for (const targetBatch of eligible) {
      if (qtyToDeduct <= 0) break;
      const idx = updatedBatches.findIndex(b => b.id === targetBatch.id);
      if (idx === -1) continue;
      const b = updatedBatches[idx];
      const deduct = Math.min(b.stock, qtyToDeduct);
      qtyToDeduct -= deduct;
      const nextStock = b.stock - deduct;
      updatedBatches[idx] = {
        ...b,
        stock: nextStock,
        status: nextStock === 0 ? ('sold_out' as const) : b.status,
      };
    }
  }
  return updatedBatches;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<Batch> & { id: string; productId: string; expiryDate: string; stock: number }): Batch {
  return {
    batchNumber: `L-${overrides.id}`,
    quantity: overrides.stock,
    elaborationDate: '2026-01-01',
    status: 'active',
    withdrawalMode: 'manual',
    ...overrides,
  };
}

// ── Suite 1: Deducción correcta de múltiples items ───────────────────────────

describe('deduceBatchesFIFO — deducción correcta de múltiples items', () => {
  it('deduce stock de un único item con un único lote', () => {
    const batches = [makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 10 })];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 3 }]);
    expect(result.find(b => b.id === 'b1')?.stock).toBe(7);
  });

  it('deduce stock de dos items de distintos productos sin interferencia', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 10 }),
      makeBatch({ id: 'b2', productId: 'p2', expiryDate: '2026-12-31', stock: 20 }),
    ];
    const result = deduceBatchesFIFO(batches, [
      { productId: 'p1', quantity: 4 },
      { productId: 'p2', quantity: 5 },
    ]);
    expect(result.find(b => b.id === 'b1')?.stock).toBe(6);
    expect(result.find(b => b.id === 'b2')?.stock).toBe(15);
  });

  it('deducción se derrama al siguiente lote cuando el primero se agota', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-06-01', stock: 2 }),
      makeBatch({ id: 'b2', productId: 'p1', expiryDate: '2026-12-01', stock: 10 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 5 }]);
    expect(result.find(b => b.id === 'b1')?.stock).toBe(0);
    expect(result.find(b => b.id === 'b2')?.stock).toBe(7);
  });

  it('si la cantidad pedida supera el stock total, deduce todo lo posible', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-06-01', stock: 3 }),
      makeBatch({ id: 'b2', productId: 'p1', expiryDate: '2026-12-01', stock: 4 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 20 }]);
    expect(result.find(b => b.id === 'b1')?.stock).toBe(0);
    expect(result.find(b => b.id === 'b2')?.stock).toBe(0);
  });

  it('no modifica lotes de productos no presentes en el carrito', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 10 }),
      makeBatch({ id: 'b2', productId: 'p2', expiryDate: '2026-12-31', stock: 8 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 3 }]);
    expect(result.find(b => b.id === 'b2')?.stock).toBe(8);
  });
});

// ── Suite 2: Orden FIFO por fecha de vencimiento ─────────────────────────────

describe('deduceBatchesFIFO — FIFO por fecha de vencimiento', () => {
  it('consume primero el lote con fecha de vencimiento más próxima', () => {
    const batches = [
      makeBatch({ id: 'b_lejano', productId: 'p1', expiryDate: '2026-12-31', stock: 5 }),
      makeBatch({ id: 'b_proximo', productId: 'p1', expiryDate: '2026-07-01', stock: 5 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 3 }]);
    // Debe consumir del lote más próximo a vencer primero
    expect(result.find(b => b.id === 'b_proximo')?.stock).toBe(2);
    expect(result.find(b => b.id === 'b_lejano')?.stock).toBe(5);
  });

  it('con tres lotes, consume en orden ascendente de expiryDate', () => {
    const batches = [
      makeBatch({ id: 'b3', productId: 'p1', expiryDate: '2026-12-01', stock: 5 }),
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-06-01', stock: 2 }),
      makeBatch({ id: 'b2', productId: 'p1', expiryDate: '2026-09-01', stock: 3 }),
    ];
    // Pedir 4: consume b1 completo (2) + 2 de b2
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 4 }]);
    expect(result.find(b => b.id === 'b1')?.stock).toBe(0);
    expect(result.find(b => b.id === 'b2')?.stock).toBe(1);
    expect(result.find(b => b.id === 'b3')?.stock).toBe(5);
  });

  it('ignora lotes con status != active en el orden FIFO', () => {
    const batches = [
      makeBatch({ id: 'b_expired', productId: 'p1', expiryDate: '2026-01-01', stock: 5, status: 'expired' }),
      makeBatch({ id: 'b_active', productId: 'p1', expiryDate: '2026-12-31', stock: 10 }),
    ];
    // El lote expirado tiene fecha más próxima pero no debe tocarse
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 3 }]);
    expect(result.find(b => b.id === 'b_expired')?.stock).toBe(5); // intacto
    expect(result.find(b => b.id === 'b_active')?.stock).toBe(7);
  });

  it('ignora lotes con stock = 0 aunque su status sea active', () => {
    const batches = [
      makeBatch({ id: 'b_empty', productId: 'p1', expiryDate: '2026-06-01', stock: 0 }),
      makeBatch({ id: 'b_full', productId: 'p1', expiryDate: '2026-12-31', stock: 10 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 4 }]);
    expect(result.find(b => b.id === 'b_empty')?.stock).toBe(0); // intacto
    expect(result.find(b => b.id === 'b_full')?.stock).toBe(6);
  });
});

// ── Suite 3: status sold_out cuando stock llega a 0 ──────────────────────────

describe('deduceBatchesFIFO — status sold_out', () => {
  it('lote que llega a stock 0 pasa a sold_out', () => {
    const batches = [makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 5 })];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 5 }]);
    const b1 = result.find(b => b.id === 'b1')!;
    expect(b1.stock).toBe(0);
    expect(b1.status).toBe('sold_out');
  });

  it('lote que NO llega a 0 mantiene su status active', () => {
    const batches = [makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 10 })];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 3 }]);
    expect(result.find(b => b.id === 'b1')?.status).toBe('active');
  });

  it('varios lotes: solo los que llegan a 0 pasan a sold_out', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-06-01', stock: 3 }),
      makeBatch({ id: 'b2', productId: 'p1', expiryDate: '2026-12-01', stock: 10 }),
    ];
    // Pedir 5: agota b1 (3→0, sold_out) y descuenta 2 de b2 (10→8, active)
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 5 }]);
    expect(result.find(b => b.id === 'b1')?.status).toBe('sold_out');
    expect(result.find(b => b.id === 'b2')?.status).toBe('active');
    expect(result.find(b => b.id === 'b2')?.stock).toBe(8);
  });

  it('no cambia status de lotes con otros estados (withdrawn, expired)', () => {
    const batches = [
      makeBatch({ id: 'b_with', productId: 'p1', expiryDate: '2026-06-01', stock: 5, status: 'withdrawn' }),
      makeBatch({ id: 'b_exp', productId: 'p1', expiryDate: '2026-06-02', stock: 5, status: 'expired' }),
      makeBatch({ id: 'b_act', productId: 'p1', expiryDate: '2026-12-31', stock: 10 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 12 }]);
    expect(result.find(b => b.id === 'b_with')?.status).toBe('withdrawn');
    expect(result.find(b => b.id === 'b_exp')?.status).toBe('expired');
  });
});

// ── Suite 4: no afecta lotes de otros productos ──────────────────────────────

describe('deduceBatchesFIFO — aislamiento entre productos', () => {
  it('deducción de p1 no afecta ningún lote de p2', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 5 }),
      makeBatch({ id: 'b2', productId: 'p2', expiryDate: '2026-12-31', stock: 8 }),
      makeBatch({ id: 'b3', productId: 'p2', expiryDate: '2026-06-01', stock: 3 }),
    ];
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 5 }]);
    expect(result.find(b => b.id === 'b2')?.stock).toBe(8);
    expect(result.find(b => b.id === 'b3')?.stock).toBe(3);
    expect(result.find(b => b.id === 'b2')?.status).toBe('active');
  });

  it('producto sin lotes activos no afecta los demás', () => {
    const batches = [
      makeBatch({ id: 'b_p2', productId: 'p2', expiryDate: '2026-12-31', stock: 10 }),
    ];
    // p1 no tiene lotes — la deducción de p1 no debe tirar ni modificar nada
    const result = deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 5 }]);
    expect(result).toHaveLength(1);
    expect(result[0].stock).toBe(10);
  });

  it('carrito vacío devuelve batches sin cambios', () => {
    const batches = [
      makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 10 }),
    ];
    const result = deduceBatchesFIFO(batches, []);
    expect(result[0].stock).toBe(10);
    expect(result[0].status).toBe('active');
  });
});

// ── Suite 5: regresión correctness N=10 items × M=100 lotes ──────────────────

describe('deduceBatchesFIFO — regresión N×M contra algoritmo original', () => {
  /**
   * Genera M lotes para un conjunto de productos.
   * Los lotes se distribuyen equitativamente entre los productos.
   */
  function generateBatches(productIds: string[], totalBatches: number, stockPerBatch: number): Batch[] {
    const result: Batch[] = [];
    for (let i = 0; i < totalBatches; i++) {
      const productId = productIds[i % productIds.length];
      // Fechas de vencimiento variadas para garantizar que el sort de FIFO trabaje
      const daysAhead = (i % 30) + 1; // 1 a 30 días
      const expiry = new Date(2026, 6, daysAhead).toISOString().slice(0, 10);
      result.push(makeBatch({
        id: `batch_${i}`,
        productId,
        expiryDate: expiry,
        stock: stockPerBatch,
      }));
    }
    return result;
  }

  it('N=10 items × M=100 lotes: resultado idéntico al algoritmo original', () => {
    const productIds = ['pa', 'pb', 'pc', 'pd', 'pe'];
    const batches = generateBatches(productIds, 100, 5);

    // 10 cart items, 2 por producto, 3 unidades cada uno
    const cartItems: CartItem[] = productIds.flatMap(pid => [
      { productId: pid, quantity: 3 },
      { productId: pid, quantity: 4 },
    ]);

    const resultOptimized = deduceBatchesFIFO(batches, cartItems);
    const resultOriginal = deduceBatchesFIFO_original(batches, cartItems);

    // Stock final de cada lote debe ser idéntico
    for (let i = 0; i < batches.length; i++) {
      expect(resultOptimized[i].stock).toBe(resultOriginal[i].stock);
    }
    // Status de cada lote debe ser idéntico
    for (let i = 0; i < batches.length; i++) {
      expect(resultOptimized[i].status).toBe(resultOriginal[i].status);
    }
  });

  it('N=10 items × M=100 lotes con agotamiento total: idéntico al original', () => {
    const productIds = ['px', 'py'];
    // 100 lotes, 1 unidad cada uno por producto → 50 lotes/producto × 1 u = 50 u disponibles
    const batches = generateBatches(productIds, 100, 1);

    // Pedir más de lo disponible para forzar agotamiento total
    const cartItems: CartItem[] = productIds.map(pid => ({ productId: pid, quantity: 999 }));

    const resultOptimized = deduceBatchesFIFO(batches, cartItems);
    const resultOriginal = deduceBatchesFIFO_original(batches, cartItems);

    for (let i = 0; i < batches.length; i++) {
      expect(resultOptimized[i].stock).toBe(resultOriginal[i].stock);
      expect(resultOptimized[i].status).toBe(resultOriginal[i].status);
    }

    // Todos los lotes activos deben estar en sold_out con stock 0
    const allSoldOut = resultOptimized.every(b => b.stock === 0 && b.status === 'sold_out');
    expect(allSoldOut).toBe(true);
  });

  it('la función pura no muta el array original de batches', () => {
    const batches = [makeBatch({ id: 'b1', productId: 'p1', expiryDate: '2026-12-31', stock: 10 })];
    const originalStock = batches[0].stock;
    deduceBatchesFIFO(batches, [{ productId: 'p1', quantity: 5 }]);
    // El array original no debe cambiar
    expect(batches[0].stock).toBe(originalStock);
  });
});
