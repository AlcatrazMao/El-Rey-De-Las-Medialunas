import { describe, expect, it } from 'vitest';

// Exact replica from workers/api/src/routes/sync.ts — assertFinitePositive.
// Lanza si el valor no es un número finito >= 0. Acepta strings convertibles
// (Number(string)) y coerciona internamente.
function assertFinitePositive(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)}`);
  }
  return n;
}

describe('assertFinitePositive (sync.ts)', () => {
  it('returns the value for a finite positive number', () => {
    expect(assertFinitePositive(123.45, 'amount')).toBe(123.45);
  });

  it('returns 0 for the literal zero (>= 0 path)', () => {
    expect(assertFinitePositive(0, 'amount')).toBe(0);
  });

  it('throws for Infinity', () => {
    expect(() => assertFinitePositive(Infinity, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for -Infinity', () => {
    expect(() => assertFinitePositive(-Infinity, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for NaN', () => {
    expect(() => assertFinitePositive(NaN, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for negatives', () => {
    expect(() => assertFinitePositive(-1, 'credit_limit')).toThrow(/INVALID_NUMERIC/);
  });

  it('accepts a numeric string ("5") because Number() converts it', () => {
    expect(assertFinitePositive('5', 'quantity')).toBe(5);
  });

  it('throws for a non-numeric string ("abc") because Number() yields NaN', () => {
    expect(() => assertFinitePositive('abc', 'quantity')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for undefined', () => {
    expect(() => assertFinitePositive(undefined, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for null only if Number(null)=0 path is not taken — null actually is 0', () => {
    // Number(null) === 0, so it passes; this documents the (acceptable) edge.
    expect(assertFinitePositive(null, 'amount')).toBe(0);
  });

  it('error message contains the field name for debugging', () => {
    try {
      assertFinitePositive(NaN, 'unit_price');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('unit_price');
    }
  });
});
