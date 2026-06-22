import { describe, it, expect } from 'vitest';

// Replica de la función `isNetworkError` en
// apps/pos-pc/src/services/d1-sync.ts.
// El predicado decide si un error es "transitorio de red" (→ encolar para
// retry) vs "permanente" (→ propagar / mostrar error al usuario). Antes sólo
// matcheaba TypeError; ahora también DOMException y AbortError.
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

describe('isNetworkError (d1-sync)', () => {
  it('TypeError → true', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('TypeError sin mensaje "fetch" igual cuenta como network', () => {
    // El predicado anterior pedía que el mensaje matcheara /fetch|network|failed/,
    // pero TypeError fuera de fetch (p.ej. tipos rotos en el JSON) no debería
    // bloquear el flujo: lo tratamos como red para que el retry lo agarre.
    expect(isNetworkError(new TypeError('cannot read prop x of undefined'))).toBe(true);
  });

  it('DOMException → true', () => {
    // jsdom/happy-dom expone DOMException global.
    const exc = new DOMException('aborted', 'AbortError');
    expect(isNetworkError(exc)).toBe(true);
  });

  it('Error con name="AbortError" → true', () => {
    const err = new Error('request aborted');
    err.name = 'AbortError';
    expect(isNetworkError(err)).toBe(true);
  });

  it('Error genérico → false', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });

  it('null → false', () => {
    expect(isNetworkError(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('string "404" → false (no es una instancia de Error)', () => {
    expect(isNetworkError('404')).toBe(false);
  });

  it('objeto plano con name AbortError → false (no es Error)', () => {
    // Importante: el guard usa `instanceof Error`, así que un objeto literal
    // que finge ser AbortError NO debe pasar.
    expect(isNetworkError({ name: 'AbortError' } as unknown)).toBe(false);
  });

  it('número → false', () => {
    expect(isNetworkError(500)).toBe(false);
  });
});
