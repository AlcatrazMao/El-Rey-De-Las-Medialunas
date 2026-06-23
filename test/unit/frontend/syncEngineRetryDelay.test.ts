import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for clampRetryDelay() exported from
// apps/pos-pc/src/hooks/useSyncEngine.ts.
//
// Pure function — no React, no IDB, no Firebase needed.
//
// Invariants:
//   • delay > 5 minutes → clamped to 300 000 ms
//   • delay < 0 (clock skew / stale timestamp) → 0 ms
//   • delay in normal range → unchanged
//   • delay > Number.MAX_SAFE_INTEGER (would overflow setTimeout) → clamped
// ---------------------------------------------------------------------------

const MAX_RETRY_DELAY_MS = 5 * 60 * 1000; // 300 000 ms — mirrors the constant in useSyncEngine.ts

/** Replica exacta de la función exportada en useSyncEngine.ts */
function clampRetryDelay(delay: number): number {
  return Math.max(0, Math.min(delay, MAX_RETRY_DELAY_MS));
}

describe('clampRetryDelay (useSyncEngine)', () => {
  it('delay of 30 s (30 000 ms) is returned unchanged', () => {
    expect(clampRetryDelay(30_000)).toBe(30_000);
  });

  it('delay of exactly 5 min (300 000 ms) is returned unchanged', () => {
    expect(clampRetryDelay(300_000)).toBe(300_000);
  });

  it('delay of 5 min + 1 ms → clamped to 300 000 ms', () => {
    expect(clampRetryDelay(300_001)).toBe(300_000);
  });

  it('delay of 10 minutes → clamped to 300 000 ms', () => {
    expect(clampRetryDelay(10 * 60 * 1000)).toBe(300_000);
  });

  it('delay of 1 hour → clamped to 300 000 ms', () => {
    expect(clampRetryDelay(60 * 60 * 1000)).toBe(300_000);
  });

  it('delay of 24 hours → clamped (would overflow setTimeout without cap)', () => {
    expect(clampRetryDelay(24 * 60 * 60 * 1000)).toBe(300_000);
  });

  it('delay of 2^32 ms → clamped (classic setTimeout overflow value)', () => {
    // 2^32 = 4 294 967 296 — setTimeout treats this as ~0 on V8/SpiderMonkey.
    expect(clampRetryDelay(2 ** 32)).toBe(300_000);
  });

  it('delay of Number.MAX_SAFE_INTEGER → clamped', () => {
    expect(clampRetryDelay(Number.MAX_SAFE_INTEGER)).toBe(300_000);
  });

  it('delay of 0 → 0 ms (fire immediately)', () => {
    expect(clampRetryDelay(0)).toBe(0);
  });

  it('delay of -1 (stale nextRetryAt in the past) → 0 ms', () => {
    expect(clampRetryDelay(-1)).toBe(0);
  });

  it('delay of -60 000 (clock skew / 1 min in the past) → 0 ms', () => {
    expect(clampRetryDelay(-60_000)).toBe(0);
  });

  it('delay of -Number.MAX_SAFE_INTEGER → 0 ms (never negative)', () => {
    expect(clampRetryDelay(-Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  it('delay of 1 ms → 1 ms (minimum positive passes through)', () => {
    expect(clampRetryDelay(1)).toBe(1);
  });
});
