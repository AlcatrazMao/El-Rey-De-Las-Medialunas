import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/utils/id.ts
function genId(): string {
  return crypto.randomUUID().replace(/-/g, '').toLowerCase();
}

describe('genId', () => {
  it('returns a string of exactly 32 characters', () => {
    expect(genId()).toHaveLength(32);
  });

  it('only contains lowercase hex characters (matches /^[0-9a-f]{32}$/)', () => {
    expect(genId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('contains no dashes', () => {
    expect(genId()).not.toContain('-');
  });

  it('returns distinct values on two consecutive calls', () => {
    const a = genId();
    const b = genId();
    expect(a).not.toBe(b);
  });

  it('produces only hex chars across a sample of 50 ids', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(genId()).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
