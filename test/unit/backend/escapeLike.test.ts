import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/routes/products.ts
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

describe('escapeLike', () => {
  it('escapes backslash first (order matters)', () => {
    expect(escapeLike('\\')).toBe('\\\\');
  });

  it('escapes % character', () => {
    expect(escapeLike('%')).toBe('\\%');
  });

  it('escapes _ character', () => {
    expect(escapeLike('_')).toBe('\\_');
  });

  it('escapes combination of backslash, % and _ in the right order', () => {
    // If order were wrong, \% would become \\% then re-escaped as \\\% — the backslash-first rule prevents that
    expect(escapeLike('\\%_')).toBe('\\\\\\%\\_');
  });

  it('passes a plain string through unchanged', () => {
    expect(escapeLike('medialunas')).toBe('medialunas');
  });

  it('passes an empty string through unchanged', () => {
    expect(escapeLike('')).toBe('');
  });

  it('handles a realistic search term with mixed special chars', () => {
    expect(escapeLike('50% off_deal\\promo')).toBe('50\\% off\\_deal\\\\promo');
  });
});
