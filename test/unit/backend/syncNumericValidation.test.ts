import { describe, expect, it } from 'vitest';

// Replica from workers/api/src/routes/sync.ts — assertFinitePositive.
// Con el typeof guard: rechaza cualquier valor que no sea number nativo primero,
// luego verifica isFinite y >= 0.
function assertFinitePositive(v: unknown, field: string): number {
  if (typeof v !== 'number') {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)} (expected number, got ${typeof v})`);
  }
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)}`);
  }
  return v;
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

  it('throws for a numeric string ("5") — typeof guard rejects non-number types', () => {
    expect(() => assertFinitePositive('5', 'quantity')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for a non-numeric string ("abc")', () => {
    expect(() => assertFinitePositive('abc', 'quantity')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for undefined', () => {
    expect(() => assertFinitePositive(undefined, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('throws for null — typeof guard cierra el edge case donde Number(null)=0 antes pasaba', () => {
    expect(() => assertFinitePositive(null, 'amount')).toThrow(/INVALID_NUMERIC/);
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
