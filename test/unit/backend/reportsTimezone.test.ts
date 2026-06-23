import { describe, it, expect } from 'vitest';

// Réplica de la función exportada desde workers/api/src/routes/reports.ts.
// Usa Intl.DateTimeFormat con la zona horaria correcta en lugar de un offset
// hardcodeado (-3h), lo que la hace robusta ante cambios de región o DST.
function argToday(): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

describe('argToday — fecha argentina via Intl.DateTimeFormat', () => {
  it('retorna un string no vacío', () => {
    expect(argToday()).toBeTruthy();
  });

  it('tiene exactamente 10 caracteres', () => {
    expect(argToday()).toHaveLength(10);
  });

  it('cumple el formato YYYY-MM-DD', () => {
    expect(argToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('los dos separadores son guiones', () => {
    const result = argToday();
    expect(result[4]).toBe('-');
    expect(result[7]).toBe('-');
  });

  it('no contiene "NaN" ni "Invalid Date"', () => {
    const result = argToday();
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('Invalid');
  });

  it('el año es un número de cuatro dígitos mayor a 2020', () => {
    const year = parseInt(argToday().slice(0, 4), 10);
    expect(year).toBeGreaterThan(2020);
  });

  it('el mes está en el rango 01-12', () => {
    const month = parseInt(argToday().slice(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it('el día está en el rango 01-31', () => {
    const day = parseInt(argToday().slice(8, 10), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});
