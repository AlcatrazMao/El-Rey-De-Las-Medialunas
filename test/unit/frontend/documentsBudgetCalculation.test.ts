import { describe, it, expect } from 'vitest';

/**
 * Tests para apps/pos-pc/src/components/documents/CreateBudgetModal.tsx
 * (change "Document Types / Comprobantes"): cálculo de total en base a items
 * (cantidad x precio unitario) y validación de valid_until antes del submit.
 *
 * Replica exacta de la derivación en CreateBudgetModal.tsx:
 *
 *   const total = useMemo(
 *     () => items.reduce((acc, it) => acc + (it.quantity > 0 ? it.quantity * it.unit_price : 0), 0),
 *     [items],
 *   );
 *
 *   const submit = async () => {
 *     if (!validUntil) { setErr('Elegí una fecha de validez'); return; }
 *     const validItems = items.filter(it => it.product_id && it.quantity > 0 && it.unit_price >= 0);
 *     if (validItems.length === 0) { setErr('Agregá al menos un producto con cantidad válida'); return; }
 *     ...
 *   };
 */

interface BudgetLineDraft {
  product_id: string;
  quantity: number;
  unit_price: number;
}

function calcBudgetTotal(items: BudgetLineDraft[]): number {
  return items.reduce((acc, it) => acc + (it.quantity > 0 ? it.quantity * it.unit_price : 0), 0);
}

function getValidBudgetItems(items: BudgetLineDraft[]): BudgetLineDraft[] {
  return items.filter(it => it.product_id && it.quantity > 0 && it.unit_price >= 0);
}

function canSubmitBudget(validUntil: string, items: BudgetLineDraft[]): { canSubmit: boolean; error: string | null } {
  if (!validUntil) return { canSubmit: false, error: 'Elegí una fecha de validez' };
  const validItems = getValidBudgetItems(items);
  if (validItems.length === 0) return { canSubmit: false, error: 'Agregá al menos un producto con cantidad válida' };
  return { canSubmit: true, error: null };
}

describe('CreateBudgetModal: cálculo de total (preview)', () => {
  it('1 item: total = cantidad x precio unitario', () => {
    const total = calcBudgetTotal([{ product_id: 'p1', quantity: 3, unit_price: 100 }]);
    expect(total).toBe(300);
  });

  it('varios items: suma el total de cada línea', () => {
    const items: BudgetLineDraft[] = [
      { product_id: 'p1', quantity: 2, unit_price: 150 },
      { product_id: 'p2', quantity: 1, unit_price: 500 },
      { product_id: 'p3', quantity: 4, unit_price: 25 },
    ];
    // 300 + 500 + 100 = 900
    expect(calcBudgetTotal(items)).toBe(900);
  });

  it('item con quantity=0 no aporta al total (aunque tenga precio)', () => {
    const total = calcBudgetTotal([{ product_id: 'p1', quantity: 0, unit_price: 999 }]);
    expect(total).toBe(0);
  });

  it('item con quantity negativa no aporta al total', () => {
    const total = calcBudgetTotal([{ product_id: 'p1', quantity: -2, unit_price: 100 }]);
    expect(total).toBe(0);
  });

  it('lista vacía: total 0', () => {
    expect(calcBudgetTotal([])).toBe(0);
  });

  it('precio unitario 0: línea aporta 0 sin romper el cálculo', () => {
    const total = calcBudgetTotal([{ product_id: 'p1', quantity: 5, unit_price: 0 }]);
    expect(total).toBe(0);
  });

  it('precios con decimales: el cálculo no acumula error grosero', () => {
    const total = calcBudgetTotal([{ product_id: 'p1', quantity: 3, unit_price: 33.33 }]);
    expect(total).toBeCloseTo(99.99, 2);
  });
});

describe('CreateBudgetModal: requiere valid_until para permitir submit', () => {
  const validItems: BudgetLineDraft[] = [{ product_id: 'p1', quantity: 1, unit_price: 100 }];

  it('sin valid_until (string vacío) — bloquea el submit con el mensaje correcto', () => {
    const { canSubmit, error } = canSubmitBudget('', validItems);
    expect(canSubmit).toBe(false);
    expect(error).toBe('Elegí una fecha de validez');
  });

  it('con valid_until — no bloquea por esa causa (si hay items válidos)', () => {
    const { canSubmit, error } = canSubmitBudget('2026-08-01', validItems);
    expect(canSubmit).toBe(true);
    expect(error).toBeNull();
  });

  it('con valid_until pero sin items válidos — bloquea con el mensaje de items', () => {
    const { canSubmit, error } = canSubmitBudget('2026-08-01', []);
    expect(canSubmit).toBe(false);
    expect(error).toBe('Agregá al menos un producto con cantidad válida');
  });

  it('sin valid_until Y sin items válidos — el chequeo de fecha bloquea primero', () => {
    const { canSubmit, error } = canSubmitBudget('', []);
    expect(canSubmit).toBe(false);
    expect(error).toBe('Elegí una fecha de validez');
  });

  it('getValidBudgetItems excluye unit_price negativo', () => {
    const items: BudgetLineDraft[] = [
      { product_id: 'p1', quantity: 1, unit_price: -10 },
      { product_id: 'p2', quantity: 1, unit_price: 0 },
    ];
    const valid = getValidBudgetItems(items);
    expect(valid).toHaveLength(1);
    expect(valid[0].product_id).toBe('p2');
  });
});
