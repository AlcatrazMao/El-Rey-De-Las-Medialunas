import { describe, it, expect } from 'vitest';

import {
  buildCategoryStats,
  deriveCategoriesFromProducts,
} from '../../../apps/pos-pc/src/utils/dashboardStats';

// Estos tests cubren la derivación dinámica de categorías que reemplazó el
// hardcode `['panes', 'facturas', 'pasteleria', 'salados', 'bebidas']` del
// widget de contabilidad en Dashboard.

describe('deriveCategoriesFromProducts', () => {
  it('lista vacía → array vacío', () => {
    expect(deriveCategoriesFromProducts([])).toEqual([]);
  });

  it('productos con categoría → categorías únicas sin duplicados', () => {
    const products = [
      { id: 'p1', category: 'panes' },
      { id: 'p2', category: 'facturas' },
      { id: 'p3', category: 'panes' },
      { id: 'p4', category: 'pasteleria' },
      { id: 'p5', category: 'facturas' },
    ];
    expect(deriveCategoriesFromProducts(products)).toEqual([
      'panes',
      'facturas',
      'pasteleria',
    ]);
  });

  it('productos sin categoría (undefined/null) → filtrados del resultado', () => {
    const products = [
      { id: 'p1', category: undefined },
      { id: 'p2', category: null },
      { id: 'p3' },
    ];
    expect(deriveCategoriesFromProducts(products)).toEqual([]);
  });

  it('mixtura de productos con y sin categoría → sólo los que tienen', () => {
    const products = [
      { id: 'p1', category: 'panes' },
      { id: 'p2', category: undefined },
      { id: 'p3', category: '' }, // string vacío también se filtra
      { id: 'p4', category: 'bebidas' },
      { id: 'p5', category: null },
    ];
    expect(deriveCategoriesFromProducts(products)).toEqual(['panes', 'bebidas']);
  });

  it('preserva orden de primera aparición', () => {
    const products = [
      { id: 'p1', category: 'bebidas' },
      { id: 'p2', category: 'panes' },
      { id: 'p3', category: 'salados' },
    ];
    expect(deriveCategoriesFromProducts(products)).toEqual([
      'bebidas',
      'panes',
      'salados',
    ]);
  });
});

describe('buildCategoryStats', () => {
  it('sin productos → objeto vacío', () => {
    expect(buildCategoryStats([], [])).toEqual({});
  });

  it('productos sin ventas → todas las categorías en 0', () => {
    const products = [
      { id: 'p1', category: 'panes' },
      { id: 'p2', category: 'facturas' },
    ];
    expect(buildCategoryStats(products, [])).toEqual({
      panes: 0,
      facturas: 0,
    });
  });

  it('suma subtotal por categoría a partir de items de venta', () => {
    const products = [
      { id: 'p1', category: 'panes' },
      { id: 'p2', category: 'facturas' },
    ];
    const sales = [
      { items: [
        { productId: 'p1', subtotal: 100 },
        { productId: 'p2', subtotal: 50 },
      ] },
      { items: [
        { productId: 'p1', subtotal: 250 },
      ] },
    ];
    expect(buildCategoryStats(products, sales)).toEqual({
      panes: 350,
      facturas: 50,
    });
  });

  it('items de productos sin categoría → ignorados', () => {
    const products = [
      { id: 'p1', category: 'panes' },
      { id: 'p2', category: undefined },
    ];
    const sales = [
      { items: [
        { productId: 'p1', subtotal: 100 },
        { productId: 'p2', subtotal: 999 }, // se ignora
      ] },
    ];
    expect(buildCategoryStats(products, sales)).toEqual({ panes: 100 });
  });

  it('items de productos desconocidos → ignorados', () => {
    const products = [{ id: 'p1', category: 'panes' }];
    const sales = [
      { items: [
        { productId: 'p1', subtotal: 100 },
        { productId: 'p-ghost', subtotal: 50 },
      ] },
    ];
    expect(buildCategoryStats(products, sales)).toEqual({ panes: 100 });
  });

  it('soporta categorías nuevas inventadas en runtime (no hardcoded)', () => {
    // Este es el corazón del fix: si alguien agrega "vegano" al catálogo
    // se debe reflejar en stats automáticamente.
    const products = [
      { id: 'p1', category: 'vegano' },
      { id: 'p2', category: 'sin_tacc' },
    ];
    const sales = [
      { items: [
        { productId: 'p1', subtotal: 200 },
        { productId: 'p2', subtotal: 150 },
      ] },
    ];
    expect(buildCategoryStats(products, sales)).toEqual({
      vegano: 200,
      sin_tacc: 150,
    });
  });
});
