import { describe, expect, it } from 'vitest';

// Réplica de la constante exportada en workers/api/src/routes/sales.ts.
// El test importa el valor real para garantizar que el módulo lo expone
// correctamente — no usamos una copia inline para no perder la vinculación.
import { TOTAL_TOLERANCE_ARS } from '../../../workers/api/src/routes/sales';

// Réplica de la lógica de validación en POST /sales (hasCanonicalTotals branch).
// Si diff > TOTAL_TOLERANCE_ARS → rechaza (400 TOTALS_MISMATCH).
// Si diff > 0 && diff <= TOTAL_TOLERANCE_ARS → acepta y loguea AUDIT warn.
// Si diff === 0 → acepta sin log.
function validateTotals(
  subtotal: number,
  discountTotal: number,
  total: number,
): { ok: boolean; auditable: boolean } {
  const diff = Math.abs(subtotal - discountTotal - total);
  if (diff > TOTAL_TOLERANCE_ARS) {
    return { ok: false, auditable: false };
  }
  return { ok: true, auditable: diff > 0 };
}

describe('TOTAL_TOLERANCE_ARS — constante exportada', () => {
  it('vale exactamente 0.05', () => {
    expect(TOTAL_TOLERANCE_ARS).toBe(0.05);
  });
});

describe('validateTotals — lógica de tolerancia contable', () => {
  it('diff === 0 → acepta sin audit', () => {
    // 1000 - 100 - 900 = 0
    const { ok, auditable } = validateTotals(1000, 100, 900);
    expect(ok).toBe(true);
    expect(auditable).toBe(false);
  });

  it('diff === 0.04 (dentro de tolerancia) → acepta con audit', () => {
    // 1000.04 - 0 - 1000 = 0.04 ≤ 0.05
    const { ok, auditable } = validateTotals(1000.04, 0, 1000);
    expect(ok).toBe(true);
    expect(auditable).toBe(true);
  });

  it('diff === 0.05 (borde exacto) → acepta con audit', () => {
    // 1000.05 - 0 - 1000 = 0.05 = TOTAL_TOLERANCE_ARS
    const { ok, auditable } = validateTotals(1000.05, 0, 1000);
    expect(ok).toBe(true);
    expect(auditable).toBe(true);
  });

  it('diff === 0.06 (fuera de tolerancia) → rechaza', () => {
    // 1000.06 - 0 - 1000 = 0.06 > 0.05
    const { ok } = validateTotals(1000.06, 0, 1000);
    expect(ok).toBe(false);
  });

  it('diff === 1 (tolerancia anterior) → ahora rechaza', () => {
    // Con la tolerancia antigua de 1 ARS, esto pasaba. Ya no debe pasar.
    const { ok } = validateTotals(1001, 0, 1000);
    expect(ok).toBe(false);
  });

  it('diff === 0.5 → rechaza', () => {
    const { ok } = validateTotals(500.5, 0, 500);
    expect(ok).toBe(false);
  });

  it('descuento incluido — diff 0 → acepta', () => {
    // subtotal 1000, descuento 100, total 900 → 1000 - 100 - 900 = 0
    const { ok, auditable } = validateTotals(1000, 100, 900);
    expect(ok).toBe(true);
    expect(auditable).toBe(false);
  });

  it('descuento incluido con diff 0.03 → acepta con audit', () => {
    // 1000 - 100 - 899.97 = 0.03 ≤ 0.05
    const { ok, auditable } = validateTotals(1000, 100, 899.97);
    expect(ok).toBe(true);
    expect(auditable).toBe(true);
  });
});
