import { describe, expect, it } from 'vitest';

// Replica local de assertFinitePositive desde workers/api/src/routes/sync.ts.
// Incluye el nuevo guard typeof que rechaza strings, null y undefined antes de
// intentar Number.isFinite — evita que "NaN" serializado como string pase.
function assertFinitePositive(v: unknown, field: string): number {
  if (typeof v !== 'number') {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)} (expected number, got ${typeof v})`);
  }
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)}`);
  }
  return v;
}

describe('assertFinitePositive — typeof guard (sync.ts)', () => {
  // ── casos que ahora deben lanzar por el nuevo typeof guard ──────────────
  it('lanza para null (antes Number(null)=0 pasaba silenciosamente)', () => {
    expect(() => assertFinitePositive(null, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para string numérico "5" (cliente serializa número como string)', () => {
    expect(() => assertFinitePositive('5', 'quantity')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para string "NaN" (caso principal del fix: NaN serializado como string)', () => {
    expect(() => assertFinitePositive('NaN', 'subtotal')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para undefined', () => {
    expect(() => assertFinitePositive(undefined, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para objeto', () => {
    expect(() => assertFinitePositive({}, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para array', () => {
    expect(() => assertFinitePositive([5], 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  // ── casos de número nativo que siguen siendo rechazados ─────────────────
  it('lanza para NaN nativo', () => {
    expect(() => assertFinitePositive(NaN, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para Infinity', () => {
    expect(() => assertFinitePositive(Infinity, 'amount')).toThrow(/INVALID_NUMERIC/);
  });

  it('lanza para negativo', () => {
    expect(() => assertFinitePositive(-1, 'credit_limit')).toThrow(/INVALID_NUMERIC/);
  });

  // ── casos válidos que no deben lanzar ────────────────────────────────────
  it('no lanza y retorna 5 para el número 5', () => {
    expect(assertFinitePositive(5, 'quantity')).toBe(5);
  });

  it('no lanza y retorna 0 para el número 0 (límite inferior válido)', () => {
    expect(assertFinitePositive(0, 'discount')).toBe(0);
  });

  it('no lanza para número decimal positivo', () => {
    expect(assertFinitePositive(123.45, 'subtotal')).toBe(123.45);
  });

  // ── mensaje de error incluye el nombre del campo ─────────────────────────
  it('el mensaje de error para typeof guard incluye el nombre del campo', () => {
    try {
      assertFinitePositive('NaN', 'unit_price');
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as Error).message).toContain('unit_price');
    }
  });

  it('el mensaje de error para NaN nativo incluye el nombre del campo', () => {
    try {
      assertFinitePositive(NaN, 'unit_price');
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as Error).message).toContain('unit_price');
    }
  });
});
