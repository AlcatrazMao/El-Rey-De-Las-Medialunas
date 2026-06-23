import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests para la lógica de concurrencia de addSale en AppContext.
 *
 * Testeamos las tres invariantes críticas como lógica pura, sin montar React:
 *
 * 1. isProcessingSaleRef previene la segunda llamada concurrente.
 * 2. El descuento de stock usa Math.max(0, stock - qty) — nunca negativo.
 * 3. invoiceNumber no se repite entre dos llamadas concurrentes (el lock lo garantiza).
 *
 * Estrategia: replicamos la lógica mínima de addSale en cada suite para poder
 * testear sin dependencias de React/hooks, igual que el resto de los tests de
 * la carpeta (ver batchNumberUniqueness.test.ts, idbRetriesCap.test.ts).
 */

// ── Tipos mínimos ────────────────────────────────────────────────────────────

interface ProductLike {
  id: string;
  stock: number;
}

// ── Suite 1: lock isProcessingSaleRef ────────────────────────────────────────

describe('addSale — lock isProcessingSaleRef', () => {
  /**
   * Réplica de la comprobación del lock al inicio de addSale.
   * Retorna { success: false, code: 'SALE_IN_PROGRESS' } si ya hay una en curso.
   */
  function makeAddSaleWithLock() {
    let isProcessing = false;

    function addSale(cartItems: { productId: string }[]): { success: boolean; error?: { code: string } } {
      if (isProcessing) {
        return { success: false, error: { code: 'SALE_IN_PROGRESS' } };
      }
      isProcessing = true;
      try {
        if (cartItems.length === 0) {
          return { success: false, error: { code: 'EMPTY_CART' } };
        }
        // ... resto del procesamiento
        return { success: true };
      } finally {
        isProcessing = false;
      }
    }

    return { addSale };
  }

  it('la primera llamada tiene éxito', () => {
    const { addSale } = makeAddSaleWithLock();
    const result = addSale([{ productId: 'p1' }]);
    expect(result.success).toBe(true);
  });

  it('devuelve SALE_IN_PROGRESS si se llama mientras isProcessing=true', () => {
    // Simulamos que el lock está activado manualmente (como si una venta previa
    // estuviera en curso y no hubiera liberado el lock aún).
    let isProcessing = false;

    function addSale(items: { productId: string }[]): { success: boolean; error?: { code: string } } {
      if (isProcessing) {
        return { success: false, error: { code: 'SALE_IN_PROGRESS' } };
      }
      isProcessing = true;
      try {
        return { success: items.length > 0 };
      } finally {
        // Simulamos que el finally NO libera el lock todavía para probar el escenario
        // intermedio. En la implementación real, async (.catch) no bloquea el finally.
        isProcessing = false;
      }
    }

    // Forzamos isProcessing desde afuera para simular la segunda llamada concurrente.
    isProcessing = true;
    const second = addSale([{ productId: 'p1' }]);
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('SALE_IN_PROGRESS');
  });

  it('el lock se libera después de una venta exitosa (segunda llamada puede proceder)', () => {
    const { addSale } = makeAddSaleWithLock();
    const first = addSale([{ productId: 'p1' }]);
    const second = addSale([{ productId: 'p1' }]);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it('el lock se libera incluso si hay un early-return (carrito vacío)', () => {
    const { addSale } = makeAddSaleWithLock();
    const emptyResult = addSale([]);
    expect(emptyResult.error?.code).toBe('EMPTY_CART');
    // Después del early-return el lock debe estar libre
    const nextResult = addSale([{ productId: 'p1' }]);
    expect(nextResult.success).toBe(true);
  });

  it('dos llamadas sincrónicamente: solo la primera prospera', () => {
    // En JS single-threaded, "concurrente" significa llamadas antes de que la
    // primera libere el lock (e.g. dentro del mismo tick, antes del finally).
    // Este test verifica el comportamiento del guard check mismo.
    let isProcessing = false;
    const results: { success: boolean; error?: { code: string } }[] = [];

    function addSaleGuardOnly(items: unknown[]): { success: boolean; error?: { code: string } } {
      if (isProcessing) return { success: false, error: { code: 'SALE_IN_PROGRESS' } };
      isProcessing = true;
      // Simular que el lock NO se libera entre las dos llamadas sincrónicamente
      return { success: items.length > 0 };
    }

    results.push(addSaleGuardOnly([1]));
    results.push(addSaleGuardOnly([2])); // lock aún activo
    isProcessing = false; // simula finally
    results.push(addSaleGuardOnly([3])); // debe funcionar

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error?.code).toBe('SALE_IN_PROGRESS');
    expect(results[2].success).toBe(true);
  });
});

// ── Suite 2: stock nunca negativo con Math.max(0, ...) ───────────────────────

describe('addSale — stock Math.max(0, stock - qty)', () => {
  /**
   * Réplica del setter funcional de setProducts dentro de addSale.
   */
  function applyStockDeduction(products: ProductLike[], cartItems: { productId: string; quantity: number }[]): ProductLike[] {
    const updated = [...products];
    for (const item of cartItems) {
      const idx = updated.findIndex(p => p.id === item.productId);
      if (idx === -1) continue;
      updated[idx] = { ...updated[idx], stock: Math.max(0, (updated[idx].stock ?? 0) - item.quantity) };
    }
    return updated;
  }

  it('descuento normal: stock 10 - qty 3 = 7', () => {
    const products: ProductLike[] = [{ id: 'p1', stock: 10 }];
    const result = applyStockDeduction(products, [{ productId: 'p1', quantity: 3 }]);
    expect(result[0].stock).toBe(7);
  });

  it('stock exacto: stock 5 - qty 5 = 0 (no negativo)', () => {
    const products: ProductLike[] = [{ id: 'p1', stock: 5 }];
    const result = applyStockDeduction(products, [{ productId: 'p1', quantity: 5 }]);
    expect(result[0].stock).toBe(0);
  });

  it('stock insuficiente: stock 3 - qty 10 → 0 (no negativo)', () => {
    const products: ProductLike[] = [{ id: 'p1', stock: 3 }];
    const result = applyStockDeduction(products, [{ productId: 'p1', quantity: 10 }]);
    expect(result[0].stock).toBe(0);
  });

  it('stock 0 - qty 5 → 0 (borde: ya en cero)', () => {
    const products: ProductLike[] = [{ id: 'p1', stock: 0 }];
    const result = applyStockDeduction(products, [{ productId: 'p1', quantity: 5 }]);
    expect(result[0].stock).toBe(0);
  });

  it('stock null/undefined → trata como 0, no lanza', () => {
    const products = [{ id: 'p1', stock: undefined as unknown as number }];
    const result = applyStockDeduction(products, [{ productId: 'p1', quantity: 2 }]);
    expect(result[0].stock).toBe(0);
  });

  it('carrito con múltiples items del mismo producto: cada deducción aplica Math.max', () => {
    const products: ProductLike[] = [{ id: 'p1', stock: 4 }];
    // Dos líneas del mismo producto (puede ocurrir si el cart lo permite)
    const result = applyStockDeduction(products, [
      { productId: 'p1', quantity: 3 },
      { productId: 'p1', quantity: 3 },
    ]);
    // Primera: Math.max(0, 4-3) = 1; Segunda: Math.max(0, 1-3) = 0
    expect(result[0].stock).toBe(0);
  });

  it('producto no encontrado en carrito → no modifica otros productos', () => {
    const products: ProductLike[] = [
      { id: 'p1', stock: 10 },
      { id: 'p2', stock: 5 },
    ];
    const result = applyStockDeduction(products, [{ productId: 'p_inexistente', quantity: 3 }]);
    expect(result[0].stock).toBe(10);
    expect(result[1].stock).toBe(5);
  });

  it('race condition simulada: dos aplicaciones del mismo snapshot → al menos una cae en Math.max', () => {
    // Simula que dos addSale leen stock=2 al mismo tiempo (snapshot stale).
    // Con Math.max, el segundo setter ve el stock ya decrementado (0) y no va negativo.
    const snapshot: ProductLike[] = [{ id: 'p1', stock: 2 }];
    const cartItem = { productId: 'p1', quantity: 2 };

    // Primera venta aplica su setter funcional
    const afterFirst = applyStockDeduction(snapshot, [cartItem]);
    expect(afterFirst[0].stock).toBe(0);

    // Segunda venta aplica su setter sobre el estado YA decrementado (lo que ve prev)
    const afterSecond = applyStockDeduction(afterFirst, [cartItem]);
    expect(afterSecond[0].stock).toBe(0); // Math.max garantiza que no va a -2
  });
});

// ── Suite 3: invoiceNumber no se repite con el lock ──────────────────────────

describe('addSale — invoiceNumber único con lock', () => {
  /**
   * El lock de isProcessingSaleRef garantiza que dos addSale no pueden correr
   * solapadas sincrónicamente. La consecuencia es que el invoiceSeqRef.current
   * se incrementa de forma serializada.
   *
   * Testeamos que la secuencia de números de factura es estrictamente creciente
   * y sin duplicados cuando las llamadas se serializan.
   */
  function makeInvoiceSequencer(initialSeq = 0) {
    let seqRef = initialSeq;
    let isProcessing = false;

    function generateInvoice(): { success: boolean; invoiceNumber?: string; error?: { code: string } } {
      if (isProcessing) {
        return { success: false, error: { code: 'SALE_IN_PROGRESS' } };
      }
      isProcessing = true;
      try {
        const nextSeq = seqRef + 1;
        const invoiceNumber = `FC-A-001-${String(nextSeq).padStart(7, '0')}`;
        seqRef = nextSeq;
        return { success: true, invoiceNumber };
      } finally {
        isProcessing = false;
      }
    }

    return { generateInvoice };
  }

  it('dos llamadas serializadas producen números distintos', () => {
    const { generateInvoice } = makeInvoiceSequencer(0);
    const r1 = generateInvoice();
    const r2 = generateInvoice();
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r1.invoiceNumber).not.toBe(r2.invoiceNumber);
  });

  it('la secuencia es estrictamente creciente', () => {
    const { generateInvoice } = makeInvoiceSequencer(0);
    const results = [generateInvoice(), generateInvoice(), generateInvoice()];
    const numbers = results.map(r => r.invoiceNumber!);
    expect(numbers[0]).toBe('FC-A-001-0000001');
    expect(numbers[1]).toBe('FC-A-001-0000002');
    expect(numbers[2]).toBe('FC-A-001-0000003');
  });

  it('segunda llamada concurrente (antes de finally) recibe SALE_IN_PROGRESS', () => {
    let seqRef = 0;
    let isProcessing = false;
    const invNumbers: string[] = [];

    function addSaleSimulated(): { success: boolean; invoiceNumber?: string; error?: { code: string } } {
      if (isProcessing) {
        return { success: false, error: { code: 'SALE_IN_PROGRESS' } };
      }
      isProcessing = true;
      const nextSeq = ++seqRef;
      invNumbers.push(`FC-A-001-${String(nextSeq).padStart(7, '0')}`);
      // No liberamos el lock aquí para simular el escenario concurrente.
      return { success: true, invoiceNumber: invNumbers[invNumbers.length - 1] };
    }

    const first = addSaleSimulated();
    const second = addSaleSimulated(); // lock aún activo
    isProcessing = false; // simula finally de la primera
    const third = addSaleSimulated();

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('SALE_IN_PROGRESS');
    expect(second.invoiceNumber).toBeUndefined();
    expect(third.success).toBe(true);
    // No hay número duplicado — la segunda no generó ninguno
    expect(new Set(invNumbers).size).toBe(invNumbers.length);
  });

  it('con lock: nunca se genera el mismo invoiceNumber dos veces en N ventas', () => {
    const { generateInvoice } = makeInvoiceSequencer(99);
    const N = 50;
    const numbers: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = generateInvoice();
      if (r.success && r.invoiceNumber) numbers.push(r.invoiceNumber);
    }
    expect(numbers.length).toBe(N);
    expect(new Set(numbers).size).toBe(N);
  });
});

// Cleanup (no hay mocks de módulos en este archivo)
afterEach(() => {
  vi.restoreAllMocks();
});
