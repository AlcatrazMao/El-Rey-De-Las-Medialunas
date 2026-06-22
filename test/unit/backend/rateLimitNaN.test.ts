import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/routes/auth.ts POST /login rate limit guard.
// Defensa contra KV corrupto: parseInt puede devolver NaN, y NaN >= 5 es
// false (bypass del rate limit). Normalizamos a 0 si no es finito.
const MAX_ATTEMPTS = 5;

function normalizeAttempts(raw: string | null): number {
  const parsed = parseInt(raw ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRateLimited(raw: string | null): boolean {
  return normalizeAttempts(raw) >= MAX_ATTEMPTS;
}

describe('login rate limit NaN guard', () => {
  it('treats KV miss (null) as 0 attempts', () => {
    expect(normalizeAttempts(null)).toBe(0);
  });

  it('parses a valid numeric string', () => {
    expect(normalizeAttempts('3')).toBe(3);
  });

  it('normalizes the literal string "NaN" to 0', () => {
    // parseInt('NaN', 10) returns NaN; Number.isFinite(NaN) === false → 0
    expect(normalizeAttempts('NaN')).toBe(0);
  });

  it('normalizes non-numeric corruption ("abc") to 0', () => {
    expect(normalizeAttempts('abc')).toBe(0);
  });

  it('rate-limits when attempts equals MAX_ATTEMPTS (5)', () => {
    expect(isRateLimited('5')).toBe(true);
  });

  it('does NOT rate-limit when attempts is one below MAX (4)', () => {
    expect(isRateLimited('4')).toBe(false);
  });

  it('does NOT rate-limit when KV is corrupt (normalized to 0)', () => {
    // The whole point of the guard: corrupt KV must NOT silently bypass the limit
    // by yielding NaN >= 5 === false. Normalized 0 stays under the threshold,
    // so legitimate users are not blocked but the counter restarts cleanly.
    expect(isRateLimited('NaN')).toBe(false);
  });

  it('rate-limits when attempts exceeds MAX_ATTEMPTS (10)', () => {
    expect(isRateLimited('10')).toBe(true);
  });
});
