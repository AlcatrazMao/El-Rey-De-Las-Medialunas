import { describe, expect, it } from 'vitest';

import type { ProductGroup } from '../types';
import {
  calcularPrecioBase,
  calcularPrecioUnitarioGrupo,
  calcularTotalFinal,
} from '../utils/productGroups';

const baseGroup = (overrides: Partial<ProductGroup> = {}): ProductGroup => ({
  id: 'grp-test',
  nombre: 'Test',
  cantidad: 6,
  descuento: 0,
  descuento_tipo: 'porcentaje',
  admite_acum_desc: 0,
  orden: 1,
  ...overrides,
});

describe('productGroups — calcularPrecioBase', () => {
  it('multiplica precio unitario por cantidad', () => {
    const g = baseGroup({ cantidad: 6 });
    expect(calcularPrecioBase(100, g)).toBe(600);
  });

  it('devuelve 0 cuando el precio unitario es 0', () => {
    const g = baseGroup({ cantidad: 12 });
    expect(calcularPrecioBase(0, g)).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    // 12.345 * 2 = 24.69 → toFixed(2) = "24.69"
    const g = baseGroup({ cantidad: 2 });
    expect(calcularPrecioBase(12.345, g)).toBe(24.69);
  });
});

describe('productGroups — calcularTotalFinal (porcentaje)', () => {
  it('aplica 10% sobre precio_base=300 → 270', () => {
    // precio_unitario=50, cantidad=6, precio_base=300, 10% descuento → 270
    const g = baseGroup({ cantidad: 6, descuento: 10, descuento_tipo: 'porcentaje' });
    expect(calcularTotalFinal(50, g)).toBe(270);
  });

  it('porcentaje 0% es igual al precio_base', () => {
    const g = baseGroup({ cantidad: 6, descuento: 0, descuento_tipo: 'porcentaje' });
    expect(calcularTotalFinal(50, g)).toBe(300);
  });

  it('porcentaje 100% deja el total en 0', () => {
    const g = baseGroup({ cantidad: 6, descuento: 100, descuento_tipo: 'porcentaje' });
    expect(calcularTotalFinal(50, g)).toBe(0);
  });

  it('redondea el resultado a 2 decimales', () => {
    // precio_base = 33.33 * 3 = 99.99, descuento 15% → 84.9915 → 84.99
    const g = baseGroup({ cantidad: 3, descuento: 15, descuento_tipo: 'porcentaje' });
    expect(calcularTotalFinal(33.33, g)).toBe(84.99);
  });
});

describe('productGroups — calcularTotalFinal (fijo)', () => {
  it('fijo 50 sobre precio_base 300 → 250', () => {
    const g = baseGroup({ cantidad: 6, descuento: 50, descuento_tipo: 'fijo' });
    expect(calcularTotalFinal(50, g)).toBe(250);
  });

  it('fijo igual al precio_base da 0', () => {
    const g = baseGroup({ cantidad: 6, descuento: 300, descuento_tipo: 'fijo' });
    expect(calcularTotalFinal(50, g)).toBe(0);
  });

  it('fijo mayor al precio_base se clampea a 0 (Math.max)', () => {
    const g = baseGroup({ cantidad: 6, descuento: 999, descuento_tipo: 'fijo' });
    expect(calcularTotalFinal(50, g)).toBe(0);
  });

  it('fijo 0 deja el total igual al precio_base', () => {
    const g = baseGroup({ cantidad: 6, descuento: 0, descuento_tipo: 'fijo' });
    expect(calcularTotalFinal(50, g)).toBe(300);
  });
});

describe('productGroups — calcularPrecioUnitarioGrupo', () => {
  it('divide el total final por la cantidad del grupo', () => {
    // total_final = 270, cantidad = 6 → 45
    const g = baseGroup({ cantidad: 6, descuento: 10, descuento_tipo: 'porcentaje' });
    expect(calcularPrecioUnitarioGrupo(50, g)).toBe(45);
  });

  it('devuelve el precio unitario original cuando la cantidad es 0 (guard)', () => {
    const g = baseGroup({ cantidad: 0 });
    expect(calcularPrecioUnitarioGrupo(123.45, g)).toBe(123.45);
  });

  it('redondea a 2 decimales', () => {
    // precio_base = 100, descuento_fijo = 33 → total_final = 67; /3 = 22.333... → 22.33
    const g = baseGroup({ cantidad: 3, descuento: 33, descuento_tipo: 'fijo' });
    expect(calcularPrecioUnitarioGrupo(33.33, g)).toBe(22.33);
  });
});
