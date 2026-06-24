import { describe, expect, it } from 'vitest';

/**
 * Tests para los fixes ALTO de backend R8:
 *  - Fix 1: cancelOrderRevertsStock — cancel de OC revierte stock de recepciones parciales
 *  - Fix 2: isProductionBatchCompletable — guard atómico contra doble ejecución de /complete
 *  - Fix 3: auditLimitSanitize — NaN en limit/page del log de auditoría
 *  - Fix 4: syncExpenseCapCheck — cap monetario en expenses via sync
 */

// ── Fix 1: cancelOrderRevertsStock ──────────────────────────────────────────
// Réplica de la lógica pura del handler POST /orders/:id/cancel en purchases.ts.
// Antes del fix: solo ejecutaba UPDATE status='cancelled' sin tocar inventario.
// Después del fix: detecta items con received_quantity > 0 y genera reversiones.

interface PurchaseOrderItem {
  product_id: string;
  received_quantity: number;
}

interface StockReversion {
  product_id: string;
  delta: number; // negativo = descuento de inventario
}

function cancelOrderRevertsStock(items: PurchaseOrderItem[]): StockReversion[] {
  return items
    .filter(item => item.received_quantity > 0)
    .map(item => ({
      product_id: item.product_id,
      delta: -item.received_quantity,
    }));
}

describe('cancelOrderRevertsStock — revertir stock al cancelar OC con recepciones parciales', () => {
  it('devuelve reversiones negativas para items con received_quantity > 0', () => {
    const items: PurchaseOrderItem[] = [
      { product_id: 'p1', received_quantity: 10 },
      { product_id: 'p2', received_quantity: 5 },
    ];
    const reversions = cancelOrderRevertsStock(items);
    expect(reversions).toHaveLength(2);
    expect(reversions[0]).toEqual({ product_id: 'p1', delta: -10 });
    expect(reversions[1]).toEqual({ product_id: 'p2', delta: -5 });
  });

  it('ignora items sin recepciones (received_quantity = 0)', () => {
    const items: PurchaseOrderItem[] = [
      { product_id: 'p1', received_quantity: 0 },
      { product_id: 'p2', received_quantity: 3 },
    ];
    const reversions = cancelOrderRevertsStock(items);
    expect(reversions).toHaveLength(1);
    expect(reversions[0]).toEqual({ product_id: 'p2', delta: -3 });
  });

  it('retorna array vacío cuando ningún item fue recibido', () => {
    const items: PurchaseOrderItem[] = [
      { product_id: 'p1', received_quantity: 0 },
      { product_id: 'p2', received_quantity: 0 },
    ];
    const reversions = cancelOrderRevertsStock(items);
    expect(reversions).toHaveLength(0);
  });

  it('retorna array vacío para OC sin items', () => {
    expect(cancelOrderRevertsStock([])).toHaveLength(0);
  });

  it('el delta siempre es negativo (descuento de inventario)', () => {
    const items: PurchaseOrderItem[] = [
      { product_id: 'p1', received_quantity: 100 },
    ];
    const reversions = cancelOrderRevertsStock(items);
    expect(reversions[0]!.delta).toBeLessThan(0);
  });

  it('la magnitud del delta iguala la cantidad recibida', () => {
    const items: PurchaseOrderItem[] = [
      { product_id: 'p1', received_quantity: 42 },
    ];
    const reversions = cancelOrderRevertsStock(items);
    expect(Math.abs(reversions[0]!.delta)).toBe(42);
  });
});

// ── Fix 2: isProductionBatchCompletable ─────────────────────────────────────
// Réplica del guard atómico en production.ts POST /batches/:id/complete.
// El UPDATE usa AND status = 'in_progress'; si changes === 0 → 409.

function isProductionBatchCompletable(currentStatus: string): boolean {
  // Solo lotes en progreso pueden completarse.
  // Esto replica el WHERE id = ? AND status = 'in_progress' del UPDATE atómico.
  return currentStatus === 'in_progress';
}

describe('isProductionBatchCompletable — guard atómico contra doble ejecución', () => {
  it('permite completar un lote en_progreso', () => {
    expect(isProductionBatchCompletable('in_progress')).toBe(true);
  });

  it('rechaza un lote ya completado (changes=0 → 409)', () => {
    expect(isProductionBatchCompletable('completed')).toBe(false);
  });

  it('rechaza un lote parcialmente completado', () => {
    expect(isProductionBatchCompletable('partial')).toBe(false);
  });

  it('rechaza un lote planificado (no fue iniciado aún)', () => {
    expect(isProductionBatchCompletable('planned')).toBe(false);
  });

  it('rechaza un lote cancelado', () => {
    expect(isProductionBatchCompletable('cancelled')).toBe(false);
  });

  it('rechaza cualquier status desconocido', () => {
    expect(isProductionBatchCompletable('unknown')).toBe(false);
    expect(isProductionBatchCompletable('')).toBe(false);
  });
});

// ── Fix 3: auditLimitSanitize ───────────────────────────────────────────────
// Réplica de la lógica de parseo y sanitización en audit.ts GET /.
// Antes del fix: parseInt("abc") → NaN; Math.min(100, NaN) → NaN → query rota.
// Después del fix: isNaN check + fallback a defaults seguros.

function auditLimitSanitize(rawLimitStr: string | undefined, rawPageStr?: string | undefined): {
  limit: number;
  page: number;
  offset: number;
} {
  const rawLimit = parseInt(rawLimitStr ?? '50', 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
  const rawPage = parseInt(rawPageStr ?? '1', 10);
  const page = Math.max(isNaN(rawPage) ? 1 : rawPage, 1);
  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

describe('auditLimitSanitize — NaN en limit/page del log de auditoría', () => {
  it('parsea correctamente un limit numérico válido', () => {
    const { limit } = auditLimitSanitize('20');
    expect(limit).toBe(20);
  });

  it('aplica fallback de 50 cuando limit es NaN (string no numérico)', () => {
    const { limit } = auditLimitSanitize('abc');
    expect(limit).toBe(50);
  });

  it('aplica fallback de 50 cuando limit es undefined', () => {
    const { limit } = auditLimitSanitize(undefined);
    expect(limit).toBe(50);
  });

  it('cap a 100 para values mayores', () => {
    const { limit } = auditLimitSanitize('999');
    expect(limit).toBe(100);
  });

  it('mínimo de 1 para values menores o iguales a 0', () => {
    expect(auditLimitSanitize('0').limit).toBe(1);
    expect(auditLimitSanitize('-5').limit).toBe(1);
  });

  it('aplica fallback de page=1 cuando page es NaN', () => {
    const { page } = auditLimitSanitize('50', 'xyz');
    expect(page).toBe(1);
  });

  it('calcula offset correctamente para page=1', () => {
    const { offset } = auditLimitSanitize('50', '1');
    expect(offset).toBe(0);
  });

  it('calcula offset correctamente para page=3 con limit=20', () => {
    const { offset } = auditLimitSanitize('20', '3');
    expect(offset).toBe(40);
  });

  it('offset es 0 cuando page es NaN (fallback a 1)', () => {
    const { offset } = auditLimitSanitize('50', 'nan');
    expect(offset).toBe(0);
  });

  it('el resultado nunca contiene NaN ni Infinity', () => {
    const cases = ['abc', '', 'NaN', 'Infinity', '-Infinity', '1e308'];
    for (const raw of cases) {
      const { limit, page, offset } = auditLimitSanitize(raw, raw);
      expect(Number.isFinite(limit)).toBe(true);
      expect(Number.isFinite(page)).toBe(true);
      expect(Number.isFinite(offset)).toBe(true);
    }
  });
});

// ── Fix 4: syncExpenseCapCheck ──────────────────────────────────────────────
// Réplica del cap de monto para expenses en sync.ts case "expense".
// Antes del fix: assertFinitePositive solo validaba >0 y finito; sin cap superior.
// Después del fix: amount > MAX_EXPENSE_AMOUNT lanza error estructurado.

const MAX_EXPENSE_AMOUNT = 10_000_000;

function syncExpenseCapCheck(amount: number, max: number): boolean {
  // Retorna true si el amount pasa el check (es válido para persistir).
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return false;
  if (amount > max) return false;
  return true;
}

describe('syncExpenseCapCheck — cap monetario en expenses vía sync', () => {
  it('acepta un gasto dentro del rango normal', () => {
    expect(syncExpenseCapCheck(1000, MAX_EXPENSE_AMOUNT)).toBe(true);
  });

  it('acepta un gasto de exactamente el máximo permitido', () => {
    expect(syncExpenseCapCheck(MAX_EXPENSE_AMOUNT, MAX_EXPENSE_AMOUNT)).toBe(true);
  });

  it('rechaza un gasto que supera el máximo', () => {
    expect(syncExpenseCapCheck(MAX_EXPENSE_AMOUNT + 1, MAX_EXPENSE_AMOUNT)).toBe(false);
  });

  it('rechaza Infinity', () => {
    expect(syncExpenseCapCheck(Infinity, MAX_EXPENSE_AMOUNT)).toBe(false);
  });

  it('rechaza NaN', () => {
    expect(syncExpenseCapCheck(NaN, MAX_EXPENSE_AMOUNT)).toBe(false);
  });

  it('rechaza valores negativos', () => {
    expect(syncExpenseCapCheck(-1, MAX_EXPENSE_AMOUNT)).toBe(false);
  });

  it('acepta cero (gasto sin monto es válido como edge case)', () => {
    expect(syncExpenseCapCheck(0, MAX_EXPENSE_AMOUNT)).toBe(true);
  });

  it('el cap es configurable — funciona con distintos máximos', () => {
    expect(syncExpenseCapCheck(500, 1000)).toBe(true);
    expect(syncExpenseCapCheck(1001, 1000)).toBe(false);
  });
});
