import { describe, it, expect } from 'vitest';

// Replica del comportamiento de `reset` en
// apps/pos-pc/src/hooks/useProductForm.ts.
// El bug original: `reset` capturaba `initial` del primer render dentro de un
// useCallback con deps vacías. Si el padre re-renderizaba con `defaults`
// nuevos, el reset seguía aplicando los valores viejos (closure stale).
// El fix: leer `initial` desde una ref que el hook actualiza en cada render.
//
// Acá modelamos el patrón ref + closure sin React testing library, porque
// `vitest` está configurado con happy-dom pero el repo no incluye
// `@testing-library/react`. Probamos la SEMÁNTICA del patrón, que es lo que
// importa: el reset usa siempre los defaults MÁS RECIENTES.

interface ProductFormDefaults {
  name?: string;
  price?: number;
  cost?: number;
  stock?: number;
  minStock?: number;
}

interface FormState {
  name: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
}

const FALLBACK_DEFAULTS: FormState = {
  name: '',
  price: 1.5,
  cost: 0.5,
  stock: 50,
  minStock: 10,
};

/**
 * Encapsula la combinación ref + reset que vive en el hook real. La función
 * `simulateRender(defaults)` simula un re-render con nuevos defaults; el reset
 * que devuelve siempre lee de la ref → siempre usa los defaults vigentes.
 */
function createFormHarness() {
  // `state` simula los useState (no nos importa setName/setPrice por separado;
  // basta con el objeto resultado para verificar).
  let state: FormState = { ...FALLBACK_DEFAULTS };
  // La ref que el hook actualiza en cada render.
  const initialRef: { current: FormState } = { current: { ...FALLBACK_DEFAULTS } };

  // El callback `reset` siempre lee de initialRef.current, NO del closure local.
  const reset = () => {
    state = { ...initialRef.current };
  };

  return {
    /** Simula un render con defaults nuevos: refresca la ref. */
    simulateRender(defaults: ProductFormDefaults = {}) {
      initialRef.current = { ...FALLBACK_DEFAULTS, ...defaults };
      // Primer "render" también inicializa el state (como un useState init).
      // Para tests sucesivos sólo actualizamos la ref — el state lo cambia el
      // usuario (typing) o el reset.
      if (state === undefined) {
        state = { ...initialRef.current };
      }
    },
    /** Simula que el usuario escribe en un input. */
    setField<K extends keyof FormState>(key: K, value: FormState[K]) {
      state = { ...state, [key]: value };
    },
    reset,
    getState: () => state,
  };
}

describe('useProductForm.reset (closure fix via ref)', () => {
  it('reset sin defaults → valores fallback', () => {
    const h = createFormHarness();
    h.simulateRender(); // no defaults

    h.setField('name', 'Pan Negro');
    h.setField('price', 999);
    expect(h.getState().name).toBe('Pan Negro');

    h.reset();
    expect(h.getState()).toEqual(FALLBACK_DEFAULTS);
  });

  it('reset con defaults → usa los defaults pasados', () => {
    const h = createFormHarness();
    h.simulateRender({ name: 'Medialuna', price: 350 });

    h.setField('price', 999);
    h.reset();
    expect(h.getState().name).toBe('Medialuna');
    expect(h.getState().price).toBe(350);
  });

  it('reset después de cambiar defaults → usa los defaults NUEVOS (no stale)', () => {
    const h = createFormHarness();
    // Primer "render" con defaults A.
    h.simulateRender({ name: 'Producto A', price: 100 });

    // El usuario edita.
    h.setField('name', 'edit-en-vivo');

    // El padre re-renderiza con defaults B (cambio de producto / edición).
    h.simulateRender({ name: 'Producto B', price: 200 });

    // El usuario hace reset: DEBE volver a defaults B, no a A.
    h.reset();
    expect(h.getState().name).toBe('Producto B');
    expect(h.getState().price).toBe(200);
  });

  it('reset preserva fallback para campos no especificados en defaults', () => {
    const h = createFormHarness();
    h.simulateRender({ name: 'Solo nombre' }); // price/cost/etc. → fallback

    h.setField('price', 999);
    h.reset();

    expect(h.getState().name).toBe('Solo nombre');
    expect(h.getState().price).toBe(FALLBACK_DEFAULTS.price);
    expect(h.getState().cost).toBe(FALLBACK_DEFAULTS.cost);
  });

  it('múltiples cambios de defaults → reset siempre toma el último', () => {
    const h = createFormHarness();
    h.simulateRender({ name: 'v1', price: 10 });
    h.simulateRender({ name: 'v2', price: 20 });
    h.simulateRender({ name: 'v3', price: 30 });

    h.setField('name', 'manual');
    h.reset();
    expect(h.getState().name).toBe('v3');
    expect(h.getState().price).toBe(30);
  });
});
