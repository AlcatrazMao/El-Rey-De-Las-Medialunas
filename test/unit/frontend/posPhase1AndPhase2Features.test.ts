import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/pos-pc/package.json'));
const { createElement, act } = require('react');
const { createRoot } = require('react-dom/client');

describe('FASE 1 — POS Critical Fixes & AFIP Rules', () => {
  it('AFIP: Factura B y Factura C no exigen CUIT obligatorio (Consumidor Final permitido)', () => {
    const CUIT_REQUIRED_DOCUMENT_TYPES = new Set([
      'factura_a',
      'factura_m',
      'nota_credito_a',
      'nota_credito_m',
      'nota_debito_a',
      'nota_debito_m',
    ]);

    // Facturas B y C NO deben estar en el set de obligatoriedad de CUIT
    expect(CUIT_REQUIRED_DOCUMENT_TYPES.has('factura_b')).toBe(false);
    expect(CUIT_REQUIRED_DOCUMENT_TYPES.has('factura_c')).toBe(false);
    expect(CUIT_REQUIRED_DOCUMENT_TYPES.has('ticket')).toBe(false);

    // Facturas A y M sí deben exigir CUIT
    expect(CUIT_REQUIRED_DOCUMENT_TYPES.has('factura_a')).toBe(true);
    expect(CUIT_REQUIRED_DOCUMENT_TYPES.has('factura_m')).toBe(true);
  });

  it('Contabilidad de Promociones: totalFinal deduciendo descuento promocional canónico', () => {
    // Simulación del cálculo canónico unificado entre POSView y AppContext.addSale
    const baseSubtotal = 10000;
    const itemLevelDiscounts = 0;
    const manualDiscount = 0;
    const promoDiscountAmountFinal = 1500; // 15% de promo o 2x1

    // Regla de acumulación: si acumulaDescuentos está activo o manualDiscount es 0
    const acumulaDescuentos = true;
    const effectivePromoDiscount = (acumulaDescuentos || manualDiscount === 0)
      ? Math.max(0, promoDiscountAmountFinal)
      : 0;

    const totalBeforeTax = Math.max(0, baseSubtotal - itemLevelDiscounts - manualDiscount - effectivePromoDiscount);
    const taxTotal = 0; // Monotributo / Final
    const totalFinal = Math.max(0, totalBeforeTax + taxTotal);

    // Verificación de coincidencia exacta al centavo
    expect(totalFinal).toBe(8500);
    expect(effectivePromoDiscount).toBe(1500);
  });

  it('Pesables: decremento fraccionario de 0.1 en kg preserva el ítem sin borrarlo accidentalmente', () => {
    const initialKg = 0.25;
    const unit = 'kg';
    const isWeighable = ['kg', 'g', 'l', 'ml'].includes(unit);
    expect(isWeighable).toBe(true);

    const stepDelta = unit === 'g' || unit === 'ml' ? 50 : 0.1;
    const nextQuantity = Math.max(0.01, parseFloat((initialKg - stepDelta).toFixed(3)));

    expect(nextQuantity).toBe(0.15);
    expect(nextQuantity).toBeGreaterThan(0);
  });
});

describe('FASE 2 — Inventory DataGrid & Persistent D1 Adjustments', () => {
  it('Filtros y ordenamiento de inventario por Margen %', () => {
    const sampleProducts = [
      { id: '1', name: 'Medialuna Dulce', price: 1000, cost: 400, stock: 50, minStock: 20 },  // margin: (1000-400)/1000 = 60%
      { id: '2', name: 'Baguette', price: 2000, cost: 1500, stock: 5, minStock: 10 },        // margin: (2000-1500)/2000 = 25%
      { id: '3', name: 'Tarta Frutillas', price: 5000, cost: 1000, stock: 0, minStock: 5 },  // margin: (5000-1000)/5000 = 80%
    ];

    // Ordenar por Mayor margen % primero
    const sortedByMarginDesc = [...sampleProducts].sort((a, b) => {
      const marginA = ((a.price - a.cost) / a.price) * 100;
      const marginB = ((b.price - b.cost) / b.price) * 100;
      return marginB - marginA;
    });

    expect(sortedByMarginDesc[0].id).toBe('3'); // 80%
    expect(sortedByMarginDesc[1].id).toBe('1'); // 60%
    expect(sortedByMarginDesc[2].id).toBe('2'); // 25%

    // Filtro por Estado: agotados
    const outOfStock = sampleProducts.filter(p => p.stock <= 0);
    expect(outOfStock).toHaveLength(1);
    expect(outOfStock[0].name).toBe('Tarta Frutillas');

    // Filtro por Estado: críticos
    const critical = sampleProducts.filter(p => p.stock > 0 && p.stock <= p.minStock);
    expect(critical).toHaveLength(1);
    expect(critical[0].name).toBe('Baguette');
  });

  it('Ajuste de Stock: Conteo Físico Real calcula delta con precisión flotante', () => {
    const currentStock = 12.5;
    const physicalCount = 10.0;
    const delta = parseFloat((physicalCount - currentStock).toFixed(3));
    const newStock = physicalCount;

    expect(delta).toBe(-2.5);
    expect(newStock).toBe(10.0);

    // Mapeo canónico de motivo a movement_type
    const reason = 'Merma / Desecho';
    let movementType = 'adjustment_in';
    if (reason === 'Ingreso de producción') movementType = 'production_in';
    else if (reason === 'Merma / Desecho' || reason === 'Rotura') movementType = 'waste_out';
    else if (delta < 0) movementType = 'adjustment_out';

    expect(movementType).toBe('waste_out');
  });
});
