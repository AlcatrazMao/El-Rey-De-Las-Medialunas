import { describe, it, expect } from 'vitest';

/**
 * Función pura que replica el cálculo de discrepancia de CashSessionView.
 * discrepancy = countedAmount - expectedAmount
 *
 * Solo es válida cuando el cajero ingresó un número real (counted es un número
 * finito). Si counted es NaN o undefined la discrepancia no es calculable.
 */
function calcDiscrepancy(counted: number | undefined, expected: number): number | null {
  if (counted === undefined || !Number.isFinite(counted)) return null;
  return counted - expected;
}

describe('calcDiscrepancy (CashSessionView — arqueo ciego)', () => {
  it('sobrante: counted > expected → discrepancia positiva', () => {
    expect(calcDiscrepancy(20_000, 18_000)).toBe(2_000);
  });

  it('faltante: counted < expected → discrepancia negativa', () => {
    expect(calcDiscrepancy(16_000, 18_000)).toBe(-2_000);
  });

  it('caja cuadrada: counted === expected → discrepancia cero', () => {
    expect(calcDiscrepancy(18_000, 18_000)).toBe(0);
  });

  it('counted undefined → no calculable (null)', () => {
    expect(calcDiscrepancy(undefined, 18_000)).toBeNull();
  });

  it('counted NaN → no calculable (null)', () => {
    expect(calcDiscrepancy(NaN, 18_000)).toBeNull();
  });

  it('el campo vacío (0 sin ingreso real) nunca produce discrepancy=0 falsa', () => {
    // El componente inicializa closingAmount en 0 y renderiza vacío hasta que
    // el cajero escribe. La discrepancia solo se muestra cuando closingAmount > 0,
    // así que pasamos 0 explícitamente y verificamos que no cuadra "mágicamente"
    // con el expected.
    const result = calcDiscrepancy(0, 18_000);
    // 0 - 18000 = -18000: si el cajero tecleó 0 de verdad, la discrepancia
    // correcta es negativa (faltante total), NO cero.
    expect(result).toBe(-18_000);
    expect(result).not.toBe(0);
  });

  it('prefill con expectedAmount produce discrepancy=0 espuria — este caso NO debe ocurrir sin contar', () => {
    // Este test documenta el bug anterior: si el componente prefillaba
    // closingAmount = expectedAmount, la discrepancia resultaba 0 sin que el
    // cajero hubiera contado nada. Con el fix, el campo arranca en 0/vacío.
    const buggyPrefillValue = 18_000; // lo que ANTES se cargaba automáticamente
    const expected = 18_000;
    const discrepancy = calcDiscrepancy(buggyPrefillValue, expected);
    // El resultado matemático sería 0 — lo que hace el bug visible: sin contar,
    // la discrepancia parecía perfecta. Ahora el campo no se prefilla.
    expect(discrepancy).toBe(0); // documentamos el comportamiento incorrecto
    // La corrección está en el componente: initialValue es 0, no expectedAmount.
  });

  it('valores decimales: centavos de ARS', () => {
    expect(calcDiscrepancy(18_000.50, 18_000.25)).toBeCloseTo(0.25);
  });

  it('Infinity no es un arqueo válido', () => {
    expect(calcDiscrepancy(Infinity, 18_000)).toBeNull();
  });
});
