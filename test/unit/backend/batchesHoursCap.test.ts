import { describe, it, expect } from 'vitest';

// Replica de la lógica de cap aplicada en batches.ts GET / handler.
// expiring_within_hours acepta valores arbitrarios del cliente; los capamos
// para evitar fechas año 5000+ o valores negativos en el bind de D1.
const MAX_HOURS = 24 * 365; // 1 año

function capHours(rawHoursNum: number): number {
  return Math.max(0, Math.min(rawHoursNum, MAX_HOURS));
}

function computeLimitDate(hours: number): string {
  const limitTs = Date.now() + hours * 3_600_000;
  return new Date(limitTs).toISOString().slice(0, 10);
}

describe('batches expiring_within_hours cap', () => {
  it('hours=1e10 queda capado a 8760', () => {
    expect(capHours(1e10)).toBe(8760);
  });

  it('hours=-1 queda en 0 (no-negativo)', () => {
    expect(capHours(-1)).toBe(0);
  });

  it('hours=24 no cambia (valor normal)', () => {
    expect(capHours(24)).toBe(24);
  });

  it('hours=8760 no cambia (exactamente 1 año)', () => {
    expect(capHours(8760)).toBe(8760);
  });

  it('la fecha resultante con cap no es Invalid Date', () => {
    const capped = capHours(1e10);
    const limitDate = computeLimitDate(capped);
    expect(limitDate).not.toBe('Invalid Date');
    expect(limitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('la fecha resultante con hours=0 es la fecha de hoy', () => {
    const limitDate = computeLimitDate(0);
    const today = new Date().toISOString().slice(0, 10);
    expect(limitDate).toBe(today);
  });

  it('hours=1e10 sin cap excede el rango válido de Date (demuestra por qué el cap es necesario)', () => {
    // 1e10 horas * 3_600_000 ms/hora supera Number.MAX_SAFE_INTEGER para timestamps,
    // lo que produce NaN al pasarle a Date — el cap en 8760 h evita esto.
    const uncappedMs = 1e10 * 3_600_000;
    expect(Number.isFinite(uncappedMs)).toBe(true);
    // El timestamp resultante supera 8.64e15 (límite de Date), causando Invalid Date.
    const uncappedDate = new Date(Date.now() + uncappedMs);
    expect(isNaN(uncappedDate.getTime())).toBe(true);
  });
});
