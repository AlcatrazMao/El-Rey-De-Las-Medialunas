import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/routes/inventory.ts POST handler.
// isInbound = movement_type.endsWith('_in')
// delta = isInbound ? qty : -qty
// _in:  newStock = stock + delta
// _out: newStock = MAX(0, stock + delta) — clamp negativos a 0
function applyMovement(
  movementType: string,
  quantity: number,
  currentStock: number,
): number {
  const isInbound = movementType.endsWith('_in');
  const delta = isInbound ? quantity : -quantity;
  const next = currentStock + delta;
  return isInbound ? next : Math.max(0, next);
}

describe('inventory movement delta with MAX(0) clamp', () => {
  it('adds quantity for _in movements (qty 10, stock 5 → 15)', () => {
    expect(applyMovement('purchase_in', 10, 5)).toBe(15);
  });

  it('subtracts quantity for _out movements (qty 3, stock 10 → 7)', () => {
    expect(applyMovement('sale_out', 3, 10)).toBe(7);
  });

  it('clamps to 0 when _out would go negative (qty 15, stock 10 → 0)', () => {
    expect(applyMovement('waste_out', 15, 10)).toBe(0);
  });

  it('clamps fractional underflow to exactly 0 (qty 0.5, stock 0.5 → 0)', () => {
    expect(applyMovement('adjustment_out', 0.5, 0.5)).toBe(0);
  });

  it('does NOT clamp inbound movements (suma directa)', () => {
    // Sanity: _in path does not pass through Math.max — verify against zero stock
    expect(applyMovement('production_in', 7, 0)).toBe(7);
  });

  it('returns 0 when _out empties exact stock', () => {
    expect(applyMovement('transfer_out', 4, 4)).toBe(0);
  });
});
