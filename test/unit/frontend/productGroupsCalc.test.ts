import { describe, it, expect } from 'vitest';

// Replica de apps/pos-pc/src/utils/productGroups.ts —
// los helpers son funciones puras, los testeamos como tales.

interface ProductGroup {
  cantidad: number;
  descuento: number;
  descuento_tipo: 'porcentaje' | 'fijo';
}

function calcularTotalFinal(unitPrice: number, group: ProductGroup): number {
  const base = unitPrice * group.cantidad;
  if (group.descuento_tipo === 'porcentaje') {
    const result = base * (1 - group.descuento / 100);
    return Math.max(0, parseFloat(result.toFixed(2)));
  }
  const result = base - group.descuento;
  return Math.max(0, parseFloat(result.toFixed(2)));
}

function calcularPrecioUnitarioGrupo(unitPrice: number, group: ProductGroup): number {
  if (group.cantidad <= 0) return unitPrice;
  return parseFloat((calcularTotalFinal(unitPrice, group) / group.cantidad).toFixed(2));
}

function calcularPrecioBase(unitPrice: number, group: ProductGroup): number {
  return parseFloat((unitPrice * group.cantidad).toFixed(2));
}

describe('GroupCard / calcularTotalFinal (descuento porcentaje)', () => {
  it('docena (12u) sin descuento → total = price * 12', () => {
    expect(calcularTotalFinal(100, { cantidad: 12, descuento: 0, descuento_tipo: 'porcentaje' }))
      .toBe(1200);
  });

  it('docena con 10% off sobre $100 → 1080 (1200 - 120)', () => {
    expect(calcularTotalFinal(100, { cantidad: 12, descuento: 10, descuento_tipo: 'porcentaje' }))
      .toBe(1080);
  });

  it('50% off → la mitad', () => {
    expect(calcularTotalFinal(100, { cantidad: 12, descuento: 50, descuento_tipo: 'porcentaje' }))
      .toBe(600);
  });

  it('100% off → 0', () => {
    expect(calcularTotalFinal(100, { cantidad: 12, descuento: 100, descuento_tipo: 'porcentaje' }))
      .toBe(0);
  });

  it('redondea a 2 decimales', () => {
    expect(calcularTotalFinal(33.33, { cantidad: 3, descuento: 10, descuento_tipo: 'porcentaje' }))
      .toBe(89.99);
  });
});

describe('GroupCard / calcularTotalFinal (descuento fijo)', () => {
  it('docena con descuento $50 sobre price $100 → 1150', () => {
    expect(calcularTotalFinal(100, { cantidad: 12, descuento: 50, descuento_tipo: 'fijo' }))
      .toBe(1150);
  });

  it('descuento fijo mayor que el subtotal → 0 (no negativo)', () => {
    expect(calcularTotalFinal(10, { cantidad: 2, descuento: 100, descuento_tipo: 'fijo' }))
      .toBe(0);
  });

  it('descuento fijo igual al subtotal → 0', () => {
    expect(calcularTotalFinal(100, { cantidad: 5, descuento: 500, descuento_tipo: 'fijo' }))
      .toBe(0);
  });
});

describe('calcularPrecioUnitarioGrupo / calcularPrecioBase', () => {
  it('precio base es price * cantidad sin descuento', () => {
    expect(calcularPrecioBase(100, { cantidad: 12, descuento: 10, descuento_tipo: 'porcentaje' }))
      .toBe(1200);
  });

  it('precio unitario al cargar al carrito = total_final / cantidad', () => {
    // 100 * 12 = 1200, -10% = 1080, /12 = 90
    expect(calcularPrecioUnitarioGrupo(100, { cantidad: 12, descuento: 10, descuento_tipo: 'porcentaje' }))
      .toBe(90);
  });

  it('cantidad 0 (defensivo) devuelve unitPrice original', () => {
    expect(calcularPrecioUnitarioGrupo(100, { cantidad: 0, descuento: 0, descuento_tipo: 'porcentaje' }))
      .toBe(100);
  });
});
