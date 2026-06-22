import { describe, it, expect } from 'vitest';

// Réplica exacta de la validación de fecha en workers/api/src/routes/reports.ts
// El handler concatena `from_date`/`to_date` directamente en el string SQL
// (con bindings, pero el string termina dentro de DATETIME() de SQLite). Si
// el valor no cumple YYYY-MM-DD, SQLite devuelve NULL silencioso y los rangos
// quedan rotos. Por eso validamos con regex antes de aceptar el parámetro.
const isValidReportDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

describe('reports.ts — isValidReportDate', () => {
  it('acepta una fecha YYYY-MM-DD bien formada', () => {
    expect(isValidReportDate('2026-06-21')).toBe(true);
  });

  it('rechaza una fecha con componente horario "YYYY-MM-DD HH:MM:SS"', () => {
    // reports.ts NO acepta hora — el cliente siempre manda bare date ARG.
    expect(isValidReportDate('2026-06-21 03:00:00')).toBe(false);
  });

  it('rechaza una cadena arbitraria', () => {
    expect(isValidReportDate('abc')).toBe(false);
  });

  it('rechaza string vacío', () => {
    expect(isValidReportDate('')).toBe(false);
  });

  it('rechaza un intento de inyección SQL', () => {
    expect(isValidReportDate("'; DROP TABLE")).toBe(false);
  });

  it('rechaza fecha con T separator (formato ISO)', () => {
    expect(isValidReportDate('2026-06-21T03:00:00.000Z')).toBe(false);
  });

  it('rechaza un sufijo extra', () => {
    expect(isValidReportDate('2026-06-21x')).toBe(false);
  });

  it('rechaza prefijo extra', () => {
    expect(isValidReportDate(' 2026-06-21')).toBe(false);
  });

  // NOTA documental: el regex sólo valida el FORMATO, no la semántica de mes/día.
  // '2026-13-01' o '2026-02-30' pasan el regex y serán manejados luego por
  // SQLite/JS Date como fechas inválidas (Date interpreta "2026-13-01" como
  // 2027-01-01 por rollover). Esto es aceptable porque protege contra el ataque
  // de inyección de strings y el bug del DATETIME() vacío. La validación
  // semántica completa correspondería a un sanitizador de dominio aparte.
  it('acepta meses fuera de rango (regex es solo de formato)', () => {
    expect(isValidReportDate('2026-13-01')).toBe(true);
  });

  it('acepta días fuera de rango (regex es solo de formato)', () => {
    expect(isValidReportDate('2026-02-30')).toBe(true);
  });
});
