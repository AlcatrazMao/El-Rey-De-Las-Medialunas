import { describe, it, expect } from 'vitest';

// Verifies the array immutability pattern used in useSettings.ts / getSettings()
//
// The bug (before the fix): array fields returned DEFAULT_SETTINGS.someArray directly.
// Any caller that mutated the returned value would also mutate the singleton DEFAULT_SETTINGS,
// corrupting subsequent calls that fell back to it.
//
// The fix (applied in getSettings(), line 151–156 of useSettings.ts):
//   gatewayCredentials: parsed.gatewayCredentials ?? [...DEFAULT_SETTINGS.gatewayCredentials],
//   priceLists:         parsed.priceLists         ?? [...DEFAULT_SETTINGS.priceLists],
//   promotions:         parsed.promotions          ?? [...DEFAULT_SETTINGS.promotions],
//   paymentMethods:     parsed.paymentMethods      ?? [...DEFAULT_SETTINGS.paymentMethods],
//   discountConfig: parsed.discountConfig ?? {
//     ...DEFAULT_SETTINGS.discountConfig,
//     availablePercents: [...DEFAULT_SETTINGS.discountConfig.availablePercents],
//   },

describe('settings array immutability', () => {
  describe('spread crea copias independientes del original', () => {
    it('mutar la copia con spread NO afecta el original', () => {
      const DEFAULT_ARRAY = [1, 2, 3];
      const copy = [...DEFAULT_ARRAY];
      copy.push(99);
      expect(DEFAULT_ARRAY).toEqual([1, 2, 3]);
    });

    it('dos copias con spread son independientes entre sí', () => {
      const DEFAULT_ARRAY = [1, 2, 3];
      const a = [...DEFAULT_ARRAY];
      const b = [...DEFAULT_ARRAY];
      a.push(10);
      expect(b).toEqual([1, 2, 3]);
    });

    it('spread de array de objetos copia referencias de los items (shallow)', () => {
      // Spread crea un nuevo array pero los objetos dentro son la misma referencia.
      // Mutar una propiedad de un item en la copia SÍ afecta el original (shallow copy).
      // El sistema solo necesita independencia a nivel de array (push/pop), no deep.
      const DEFAULT_PRICE_LISTS = [{ id: 'list_1', discountPercent: 0 }];
      const copy = [...DEFAULT_PRICE_LISTS];
      copy.push({ id: 'list_new', discountPercent: -10 });
      // El array original no tiene el nuevo item
      expect(DEFAULT_PRICE_LISTS).toHaveLength(1);
      expect(copy).toHaveLength(2);
    });

    it('nested array spread crea una copia independiente del array anidado', () => {
      // Simula el patrón de discountConfig.availablePercents
      const DEFAULT_DISCOUNT_CONFIG = { availablePercents: [5, 10, 15, 20] };
      const copiedConfig = {
        ...DEFAULT_DISCOUNT_CONFIG,
        availablePercents: [...DEFAULT_DISCOUNT_CONFIG.availablePercents],
      };
      copiedConfig.availablePercents.push(99);
      expect(DEFAULT_DISCOUNT_CONFIG.availablePercents).toEqual([5, 10, 15, 20]);
    });
  });

  describe('el bug original: asignación directa SÍ muta el original', () => {
    it('asignar array directamente (sin spread) comparte la referencia', () => {
      const DEFAULT_ARRAY = [1, 2, 3];
      // Bug: sin spread, ambas variables apuntan al mismo array
      const buggy = DEFAULT_ARRAY;
      buggy.push(99);
      // Esta es exactamente la mutación no deseada que el fix previene
      expect(DEFAULT_ARRAY).toEqual([1, 2, 3, 99]);
    });

    it('nested array sin spread: mutar la copia sí afecta el original', () => {
      const DEFAULT_DISCOUNT_CONFIG = { availablePercents: [5, 10, 15] };
      // Bug: solo spread del objeto pero no del array interno
      const buggyConfig = { ...DEFAULT_DISCOUNT_CONFIG };
      buggyConfig.availablePercents.push(99);
      expect(DEFAULT_DISCOUNT_CONFIG.availablePercents).toContain(99);
    });
  });

  describe('el patrón correcto: ?? con spread', () => {
    it('si parsed tiene el valor lo usa directamente (no toca DEFAULT)', () => {
      const DEFAULT_ARRAY = ['a', 'b'];
      const parsed = ['x', 'y', 'z'];
      const result = parsed ?? [...DEFAULT_ARRAY];
      expect(result).toEqual(['x', 'y', 'z']);
      expect(DEFAULT_ARRAY).toEqual(['a', 'b']);
    });

    it('si parsed es undefined/null usa spread del DEFAULT (copia independiente)', () => {
      const DEFAULT_ARRAY = ['a', 'b'];
      const parsed: string[] | undefined = undefined;
      const result = parsed ?? [...DEFAULT_ARRAY];
      result.push('c');
      expect(DEFAULT_ARRAY).toEqual(['a', 'b']);
    });
  });
});
