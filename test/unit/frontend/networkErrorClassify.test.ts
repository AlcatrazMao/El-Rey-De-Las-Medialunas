import { describe, it, expect } from 'vitest';

// Replica de la función `isNetworkError` en
// apps/pos-pc/src/services/d1-sync.ts.
// Solo DOMException con name en {AbortError, NetworkError, TimeoutError} son
// errores de red. QuotaExceededError, NotAllowedError, etc. NO lo son.
const NETWORK_DOM_EXCEPTION_NAMES = new Set(['AbortError', 'NetworkError', 'TimeoutError']);

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && /fetch|network|failed/i.test(err.message)) return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return NETWORK_DOM_EXCEPTION_NAMES.has(err.name);
  }
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

describe('isNetworkError (d1-sync)', () => {
  it('TypeError con mensaje "Failed to fetch" → true', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('TypeError con mensaje "network error" → true', () => {
    expect(isNetworkError(new TypeError('network error'))).toBe(true);
  });

  it('TypeError con mensaje "Load failed" → true', () => {
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
  });

  it('TypeError sin mensaje de red → false (no confundir con network)', () => {
    // TypeError por tipos rotos no es un error de red transitorio.
    expect(isNetworkError(new TypeError('cannot read prop x of undefined'))).toBe(false);
  });

  it('DOMException AbortError → true', () => {
    expect(isNetworkError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('DOMException NetworkError → true', () => {
    expect(isNetworkError(new DOMException('network', 'NetworkError'))).toBe(true);
  });

  it('DOMException TimeoutError → true', () => {
    expect(isNetworkError(new DOMException('timeout', 'TimeoutError'))).toBe(true);
  });

  it('DOMException QuotaExceededError → false (no es error de red)', () => {
    expect(isNetworkError(new DOMException('quota exceeded', 'QuotaExceededError'))).toBe(false);
  });

  it('DOMException NotAllowedError → false (no es error de red)', () => {
    expect(isNetworkError(new DOMException('not allowed', 'NotAllowedError'))).toBe(false);
  });

  it('Error con name="AbortError" → true (plataformas sin DOMException)', () => {
    const err = new Error('request aborted');
    err.name = 'AbortError';
    expect(isNetworkError(err)).toBe(true);
  });

  it('Error genérico → false', () => {
    expect(isNetworkError(new Error('server error'))).toBe(false);
  });

  it('null → false', () => {
    expect(isNetworkError(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('string "404" → false', () => {
    expect(isNetworkError('404')).toBe(false);
  });

  it('número → false', () => {
    expect(isNetworkError(500)).toBe(false);
  });

  it('objeto plano con name AbortError → false (no es instancia de Error)', () => {
    expect(isNetworkError({ name: 'AbortError' } as unknown)).toBe(false);
  });
});
