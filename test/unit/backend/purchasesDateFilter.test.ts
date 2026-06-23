import { describe, it, expect } from 'vitest';

// Réplica exacta de las funciones de normalización copiadas en purchases.ts.
// El cliente envía fechas en hora Argentina (UTC-3). created_at se guarda en
// UTC, igual que en expenses.ts y sales.ts:
//   from_date "YYYY-MM-DD" (ARG 00:00)    → "YYYY-MM-DDT03:00:00.000Z"
//   to_date   "YYYY-MM-DD" (ARG 23:59:59) → "YYYY-MM-(DD+1)T02:59:59.999Z"
const isBareDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const argDateToUtcFrom = (d: string): string => `${d}T03:00:00.000Z`;
const argDateToUtcTo = (d: string): string => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.toISOString().slice(0, 10)}T02:59:59.999Z`;
};

describe('purchases ARG→UTC date filter helpers', () => {
  describe('from_date normalization', () => {
    it('from_date="2026-06-22" se convierte a "2026-06-22T03:00:00.000Z"', () => {
      const fromDate = '2026-06-22';
      const result = isBareDate(fromDate) ? argDateToUtcFrom(fromDate) : fromDate;
      expect(result).toBe('2026-06-22T03:00:00.000Z');
    });

    it('from_date con hora incluida no se modifica', () => {
      const fromDate = '2026-06-22T03:00:00.000Z';
      const result = isBareDate(fromDate) ? argDateToUtcFrom(fromDate) : fromDate;
      expect(result).toBe('2026-06-22T03:00:00.000Z');
    });
  });

  describe('to_date normalization', () => {
    it('to_date="2026-06-22" se convierte a "2026-06-23T02:59:59.999Z"', () => {
      const toDate = '2026-06-22';
      const result = isBareDate(toDate) ? argDateToUtcTo(toDate) : toDate;
      expect(result).toBe('2026-06-23T02:59:59.999Z');
    });

    it('to_date con hora incluida no se modifica', () => {
      const toDate = '2026-06-22T02:59:59.999Z';
      const result = isBareDate(toDate) ? argDateToUtcTo(toDate) : toDate;
      expect(result).toBe('2026-06-22T02:59:59.999Z');
    });

    it('to_date fin de mes rueda correctamente (2026-06-30 → 2026-07-01)', () => {
      const toDate = '2026-06-30';
      const result = isBareDate(toDate) ? argDateToUtcTo(toDate) : toDate;
      expect(result).toBe('2026-07-01T02:59:59.999Z');
    });

    it('to_date fin de año rueda correctamente (2026-12-31 → 2027-01-01)', () => {
      const toDate = '2026-12-31';
      const result = isBareDate(toDate) ? argDateToUtcTo(toDate) : toDate;
      expect(result).toBe('2027-01-01T02:59:59.999Z');
    });
  });
});
