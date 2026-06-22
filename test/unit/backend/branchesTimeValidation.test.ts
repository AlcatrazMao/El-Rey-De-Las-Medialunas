import { describe, expect, it } from 'vitest';

// Exact replica from workers/api/src/routes/branches.ts — TIME_REGEX.
// Formato HH:MM 24h, 00:00 — 23:59. Cualquier otro string es inválido.
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

describe('TIME_REGEX (branches.ts)', () => {
  it('accepts 08:00', () => {
    expect(TIME_REGEX.test('08:00')).toBe(true);
  });

  it('accepts 23:59', () => {
    expect(TIME_REGEX.test('23:59')).toBe(true);
  });

  it('accepts 00:00 (midnight)', () => {
    expect(TIME_REGEX.test('00:00')).toBe(true);
  });

  it('rejects 24:00 (hour out of range)', () => {
    expect(TIME_REGEX.test('24:00')).toBe(false);
  });

  it('rejects 8:00 (missing leading zero in hour)', () => {
    expect(TIME_REGEX.test('8:00')).toBe(false);
  });

  it('rejects 08:60 (minutes out of range)', () => {
    expect(TIME_REGEX.test('08:60')).toBe(false);
  });

  it('rejects "abc"', () => {
    expect(TIME_REGEX.test('abc')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(TIME_REGEX.test('')).toBe(false);
  });
});
