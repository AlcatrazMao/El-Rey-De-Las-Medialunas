import { describe, it, expect } from 'vitest';

// Exact validation from workers/api/src/routes/inventory.ts, POST /adjust
// if (typeof body.quantity !== 'number' || body.quantity <= 0 || !isFinite(body.quantity))
function isValidQuantity(quantity: unknown): boolean {
  return typeof quantity === 'number' && quantity > 0 && isFinite(quantity);
}

describe('inventory quantity validation', () => {
  it('accepts a positive integer', () => {
    expect(isValidQuantity(10)).toBe(true);
  });

  it('accepts a positive decimal', () => {
    expect(isValidQuantity(0.5)).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidQuantity(0)).toBe(false);
  });

  it('rejects a negative number', () => {
    expect(isValidQuantity(-1)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidQuantity(NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidQuantity(Infinity)).toBe(false);
  });

  it('rejects negative Infinity', () => {
    expect(isValidQuantity(-Infinity)).toBe(false);
  });

  it('rejects a numeric string', () => {
    expect(isValidQuantity('5')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidQuantity(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidQuantity(undefined)).toBe(false);
  });
});
