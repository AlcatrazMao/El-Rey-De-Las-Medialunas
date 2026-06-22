import { describe, it, expect } from 'vitest';

// Replica de la decisión 4xx vs 5xx implementada en
// apps/pos-pc/src/hooks/useSyncEngine.ts (flushSalesQueue).
// 4xx → payload-side error → no tiene sentido reintentar → permanentlyFailed.
// 5xx → transient server error → reintentar (incrementRetries).
// Encapsulamos la decisión como función pura para testearla en aislamiento.

interface ClassifyResult {
  permanentlyFailed: boolean;
}

function classifyResponseStatus(status: number): ClassifyResult {
  if (status >= 400 && status < 500) {
    return { permanentlyFailed: true };
  }
  // Implícitamente: 5xx y otros >=500 → retry.
  return { permanentlyFailed: false };
}

describe('classifyResponseStatus (useSyncEngine)', () => {
  it('HTTP 400 → permanentlyFailed = true', () => {
    expect(classifyResponseStatus(400)).toEqual({ permanentlyFailed: true });
  });

  it('HTTP 401 → permanentlyFailed = true', () => {
    expect(classifyResponseStatus(401)).toEqual({ permanentlyFailed: true });
  });

  it('HTTP 422 → permanentlyFailed = true', () => {
    expect(classifyResponseStatus(422)).toEqual({ permanentlyFailed: true });
  });

  it('HTTP 500 → permanentlyFailed = false (retry)', () => {
    expect(classifyResponseStatus(500)).toEqual({ permanentlyFailed: false });
  });

  it('HTTP 503 → permanentlyFailed = false (retry)', () => {
    expect(classifyResponseStatus(503)).toEqual({ permanentlyFailed: false });
  });

  it('borde inferior 4xx (400) considerado permanente', () => {
    expect(classifyResponseStatus(400).permanentlyFailed).toBe(true);
  });

  it('borde superior 4xx (499) considerado permanente', () => {
    expect(classifyResponseStatus(499).permanentlyFailed).toBe(true);
  });

  it('borde inferior 5xx (500) considerado transitorio', () => {
    expect(classifyResponseStatus(500).permanentlyFailed).toBe(false);
  });
});
