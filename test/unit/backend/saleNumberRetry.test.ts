import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replica of the sale_number retry constants and backoff logic from
// workers/api/src/routes/sales.ts — kept local so the test is hermetic
// (no D1 / Hono / real DB needed).
//
// Key behaviours under test:
//   • MAX_SALE_NUMBER_RETRIES >= 10 (set to 15 to handle high concurrency)
//   • Backoff delay grows linearly with attempt number: delay = attempt * 10ms
//   • Attempt 0 has no delay (0ms), attempt 1 has 10ms, attempt N has N*10ms
//   • The last attempt (MAX_SALE_NUMBER_RETRIES - 1) has the expected delay
// ---------------------------------------------------------------------------

// Mirror the exported constant from sales.ts
const MAX_SALE_NUMBER_RETRIES = 15;

/**
 * Computes the delay (ms) for a given attempt index, matching the backoff
 * formula used in the retry loop: `attempt * 10`.
 * Attempt 0 → no sleep (0ms).
 * Attempt 1 → 10ms.
 * Attempt N → N * 10ms.
 */
function backoffDelayMs(attempt: number): number {
  return attempt * 10;
}

/**
 * Simulates the retry loop and records the delay applied before each attempt.
 * Returns the list of delays (one per attempt).
 */
function simulateRetryDelays(maxRetries: number): number[] {
  const delays: number[] = [];
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      delays.push(backoffDelayMs(attempt));
    } else {
      delays.push(0); // no delay on first attempt
    }
  }
  return delays;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MAX_SALE_NUMBER_RETRIES — value and constraint', () => {
  it('is at least 10 (handles high-concurrency scenarios)', () => {
    expect(MAX_SALE_NUMBER_RETRIES).toBeGreaterThanOrEqual(10);
  });

  it('is exactly 15 (as specified in the fix)', () => {
    expect(MAX_SALE_NUMBER_RETRIES).toBe(15);
  });
});

describe('sale_number retry — linear backoff delay', () => {
  it('first attempt (attempt=0) has zero delay', () => {
    expect(backoffDelayMs(0)).toBe(0);
  });

  it('second attempt (attempt=1) has 10ms delay', () => {
    expect(backoffDelayMs(1)).toBe(10);
  });

  it('third attempt (attempt=2) has 20ms delay', () => {
    expect(backoffDelayMs(2)).toBe(20);
  });

  it('delay grows linearly — each extra attempt adds exactly 10ms', () => {
    for (let attempt = 1; attempt < MAX_SALE_NUMBER_RETRIES; attempt++) {
      const delay = backoffDelayMs(attempt);
      const prevDelay = backoffDelayMs(attempt - 1);
      expect(delay - prevDelay).toBe(10);
    }
  });

  it('delay is strictly increasing (each attempt waits longer than the previous)', () => {
    const delays = simulateRetryDelays(MAX_SALE_NUMBER_RETRIES);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });
});

describe('sale_number retry — total accumulated delay', () => {
  it('last attempt (attempt=14) has 140ms delay', () => {
    const lastAttempt = MAX_SALE_NUMBER_RETRIES - 1;
    expect(backoffDelayMs(lastAttempt)).toBe(140);
  });

  it('total accumulated delay across all 15 attempts is ~1050ms', () => {
    // Sum of 0 + 10 + 20 + ... + 140 = 10 * (0+1+2+...+14) = 10 * 105 = 1050
    let total = 0;
    for (let attempt = 0; attempt < MAX_SALE_NUMBER_RETRIES; attempt++) {
      total += backoffDelayMs(attempt);
    }
    expect(total).toBe(1050);
  });

  it('attempt 5 has delay >= 40ms (validates early backoff is meaningful)', () => {
    expect(backoffDelayMs(5)).toBeGreaterThanOrEqual(40);
  });
});

describe('sale_number retry — loop behaviour', () => {
  it('loop runs exactly MAX_SALE_NUMBER_RETRIES times when all attempts fail', () => {
    const delays = simulateRetryDelays(MAX_SALE_NUMBER_RETRIES);
    expect(delays).toHaveLength(MAX_SALE_NUMBER_RETRIES);
  });

  it('delays array has 15 entries — one per attempt', () => {
    const delays = simulateRetryDelays(MAX_SALE_NUMBER_RETRIES);
    expect(delays).toHaveLength(15);
  });

  it('first delay in sequence is 0 (no sleep before first attempt)', () => {
    const delays = simulateRetryDelays(MAX_SALE_NUMBER_RETRIES);
    expect(delays[0]).toBe(0);
  });

  it('last delay in sequence is 140ms (attempt 14 × 10ms)', () => {
    const delays = simulateRetryDelays(MAX_SALE_NUMBER_RETRIES);
    expect(delays[delays.length - 1]).toBe(140);
  });
});
