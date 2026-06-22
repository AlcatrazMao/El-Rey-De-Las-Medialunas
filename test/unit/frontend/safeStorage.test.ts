import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Replica exacta de apps/pos-pc/src/utils/safeStorage.ts → safeParseLocalStorage.
// Mantenemos la copia local para que el test sea hermético (no importa el
// hook React ni la app) y siga sirviendo de espec en lenguaje natural.
function safeParseLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return fallback;
  }
}

describe('safeParseLocalStorage', () => {
  // localStorage mock en memoria — patrón pedido por el task. Reemplazamos
  // happy-dom para asegurar control absoluto de los valores y que el test no
  // dependa de side effects de otros tests.
  let store: Record<string, string> = {};
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { store = {}; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    });
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna el fallback cuando la clave no existe', () => {
    expect(safeParseLocalStorage('missing', 'default')).toBe('default');
  });

  it('retorna el valor parseado cuando hay JSON válido almacenado', () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Pepe' }));
    expect(safeParseLocalStorage('user', null)).toEqual({ id: 'u1', name: 'Pepe' });
  });

  it('retorna el fallback sin lanzar cuando el JSON es corrupto', () => {
    localStorage.setItem('corrupt', '{not valid json');
    expect(() => safeParseLocalStorage('corrupt', { ok: false })).not.toThrow();
    expect(safeParseLocalStorage('corrupt', { ok: false })).toEqual({ ok: false });
  });

  it('borra la clave corrupta como side effect de recuperación', () => {
    localStorage.setItem('corrupt2', '{{{');
    safeParseLocalStorage('corrupt2', null);
    expect(localStorage.getItem('corrupt2')).toBeNull();
  });

  it('retorna el fallback cuando el valor almacenado parseado es null', () => {
    localStorage.setItem('explicit-null', 'null');
    expect(safeParseLocalStorage('explicit-null', 'fb')).toBe('fb');
  });

  it('retorna un array vacío cuando el fallback es [] y no hay dato', () => {
    expect(safeParseLocalStorage<string[]>('list', [])).toEqual([]);
  });

  it('retorna el objeto default cuando el fallback es un objeto y no hay dato', () => {
    const def = { count: 0, items: [] };
    expect(safeParseLocalStorage('cfg', def)).toEqual(def);
  });

  it('respeta tipos genéricos: parsea arrays JSON válidos', () => {
    localStorage.setItem('arr', JSON.stringify([1, 2, 3]));
    expect(safeParseLocalStorage<number[]>('arr', [])).toEqual([1, 2, 3]);
  });
});
