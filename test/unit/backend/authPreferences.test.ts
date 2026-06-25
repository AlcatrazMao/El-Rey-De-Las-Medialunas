import { describe, it, expect } from 'vitest';

// Exact validation from workers/api/src/routes/auth.ts, PUT /preferences
// Rule 1: custom_panels must be an array
// Rule 2: length > 20 OR any element is not a string OR any element length > 100 → rejected
function isValidCustomPanels(panels: unknown): boolean {
  if (!Array.isArray(panels)) return false;
  if (panels.length > 20) return false;
  if (panels.some((p) => typeof p !== 'string' || p.length > 100)) return false;
  return true;
}

describe('preferences panel validation', () => {
  it('accepts an array of up to 20 short strings', () => {
    const panels = Array.from({ length: 20 }, (_, i) => `panel_${i}`);
    expect(isValidCustomPanels(panels)).toBe(true);
  });

  it('rejects an array of 21 elements (exceeds max 20)', () => {
    const panels = Array.from({ length: 21 }, (_, i) => `panel_${i}`);
    expect(isValidCustomPanels(panels)).toBe(false);
  });

  it('accepts a string of exactly 100 characters', () => {
    const panel = 'a'.repeat(100);
    expect(isValidCustomPanels([panel])).toBe(true);
  });

  it('rejects a string of 101 characters', () => {
    const panel = 'a'.repeat(101);
    expect(isValidCustomPanels([panel])).toBe(false);
  });

  it('rejects an array containing a number instead of a string', () => {
    expect(isValidCustomPanels(['valid', 42])).toBe(false);
  });

  it('rejects an array containing null', () => {
    expect(isValidCustomPanels(['valid', null])).toBe(false);
  });

  it('accepts an empty array', () => {
    expect(isValidCustomPanels([])).toBe(true);
  });

  it('rejects a non-array value (object)', () => {
    expect(isValidCustomPanels({ panels: ['a'] })).toBe(false);
  });

  it('rejects a non-array value (string)', () => {
    expect(isValidCustomPanels('panel_1')).toBe(false);
  });
});
