import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/routes/expenses.ts GET / handler.
// El cliente envía fechas en hora Argentina (UTC-3). created_at se guarda
// en UTC, así que convertimos:
//   from_date "YYYY-MM-DD" (ARG 00:00)        → "YYYY-MM-DDT03:00:00.000Z"
//   to_date   "YYYY-MM-DD" (ARG 23:59:59)     → "YYYY-MM-(DD+1)T02:59:59.999Z"
const isBareDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const argDateToUtcFrom = (d: string): string => `${d}T03:00:00.000Z`;
const argDateToUtcTo = (d: string): string => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.toISOString().slice(0, 10)}T02:59:59.999Z`;
};

describe('expenses ARG→UTC date filter helpers', () => {
  describe('isBareDate', () => {
    it('returns true for a plain YYYY-MM-DD string', () => {
      expect(isBareDate('2026-06-21')).toBe(true);
    });

    it('returns false when the string includes a time component', () => {
      expect(isBareDate('2026-06-21 03:00:00')).toBe(false);
    });

    it('returns false for an ISO string with T separator', () => {
      expect(isBareDate('2026-06-21T03:00:00.000Z')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isBareDate('')).toBe(false);
    });
  });

  describe('argDateToUtcFrom', () => {
    it('appends T03:00:00.000Z to the bare ARG date', () => {
      // ARG midnight = 03:00 UTC the same day
      expect(argDateToUtcFrom('2026-06-21')).toBe('2026-06-21T03:00:00.000Z');
    });
  });

  describe('argDateToUtcTo', () => {
    it('rolls to the next day at 02:59:59.999 UTC (ARG 23:59:59)', () => {
      // ARG 2026-06-21 23:59:59 (-03:00) = 2026-06-22 02:59:59 UTC
      expect(argDateToUtcTo('2026-06-21')).toBe('2026-06-22T02:59:59.999Z');
    });

    it('rolls month boundary correctly (2026-06-30 → 2026-07-01)', () => {
      expect(argDateToUtcTo('2026-06-30')).toBe('2026-07-01T02:59:59.999Z');
    });

    it('rolls year boundary correctly (2026-12-31 → 2027-01-01)', () => {
      expect(argDateToUtcTo('2026-12-31')).toBe('2027-01-01T02:59:59.999Z');
    });
  });
});
