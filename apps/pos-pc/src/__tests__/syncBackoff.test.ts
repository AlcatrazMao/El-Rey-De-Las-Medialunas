import { describe, expect, it } from 'vitest';

import { calcNextRetry, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from '../services/d1-sync';

describe('calcNextRetry — backoff exponencial con jitter', () => {
  it('intento 0 → delay >= BACKOFF_BASE_MS (5_000)', () => {
    const before = Date.now();
    const iso = calcNextRetry(0);
    const after = Date.now();
    const delay = new Date(iso).getTime() - before;
    // base + jitter[0..1000) > base
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_BASE_MS);
    expect(delay).toBeLessThanOrEqual(BACKOFF_BASE_MS + 1_000 + (after - before));
  });

  it('intento 10 → delay <= BACKOFF_MAX_MS (300_000)', () => {
    const before = Date.now();
    const iso = calcNextRetry(10);
    const delay = new Date(iso).getTime() - before;
    // 5000 * 2^10 = 5_120_000 > 300_000 → debe quedar capped
    expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS + 1_000);
  });

  it('dos llamadas seguidas dan timestamps distintos (jitter)', () => {
    // Con jitter de [0, 1000), la probabilidad de colisión es ~1/1000.
    // Hacemos varios pares para minimizar falso negativo.
    let distinct = 0;
    for (let i = 0; i < 20; i++) {
      const a = calcNextRetry(0);
      const b = calcNextRetry(0);
      if (a !== b) distinct++;
    }
    // Al menos uno debe ser distinto (jitter activo).
    expect(distinct).toBeGreaterThan(0);
  });

  it('intento 1 da delay >= intento 0 (crecimiento monotónico esperado)', () => {
    // Como hay jitter, comparamos lower bound determinístico (BASE * 2^n).
    const before = Date.now();
    const iso0 = calcNextRetry(0);
    const iso1 = calcNextRetry(1);
    const d0 = new Date(iso0).getTime() - before;
    const d1 = new Date(iso1).getTime() - before;
    // d0 ∈ [5000, 6000+ε], d1 ∈ [10000, 11000+ε]
    expect(d1).toBeGreaterThan(d0);
  });
});
