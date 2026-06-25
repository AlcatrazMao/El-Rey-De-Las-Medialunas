import { describe, it, expect } from 'vitest';

// Replica of price list adjustment logic from apps/pos-pc/src/components/POSView.tsx
//
// Source (lines 562–571):
//   const pmConfig = posSettings.paymentMethods?.find(m => m.id === paymentMethod);
//   const activePriceList = pmConfig?.linkedPriceListId
//     ? (posSettings.priceLists.find(pl => pl.id === pmConfig.linkedPriceListId) ?? null)
//     : null;
//   const priceListDiscountPercent = activePriceList?.discountPercent ?? 0;
//   const priceListAdjustmentAmount = priceListDiscountPercent !== 0
//     ? parseFloat((afterDiscount * priceListDiscountPercent / 100).toFixed(2))
//     : 0;
//
// Semantics:
//   - Positive discountPercent → descuento (reduces price): adjustment is subtracted from total
//   - Negative discountPercent → recargo (increases price): adjustment is subtracted (negative value adds)
//   - No linkedPriceListId on payment method → activePriceList is null → adjustment is 0

interface PriceList {
  id: string;
  discountPercent: number;
}

interface PaymentMethodConfig {
  id: string;
  linkedPriceListId?: string;
}

function calcPriceListAdjustment(
  afterDiscount: number,
  paymentMethodId: string,
  paymentMethods: PaymentMethodConfig[],
  priceLists: PriceList[]
): number {
  const pmConfig = paymentMethods.find(m => m.id === paymentMethodId);
  const activePriceList = pmConfig?.linkedPriceListId
    ? (priceLists.find(pl => pl.id === pmConfig.linkedPriceListId) ?? null)
    : null;
  const priceListDiscountPercent = activePriceList?.discountPercent ?? 0;
  const priceListAdjustmentAmount = priceListDiscountPercent !== 0
    ? parseFloat((afterDiscount * priceListDiscountPercent / 100).toFixed(2))
    : 0;
  return priceListAdjustmentAmount;
}

// Helpers for fixtures
const listDescuento: PriceList = { id: 'list_mostrador', discountPercent: 10 };
const listMayorista: PriceList = { id: 'list_mayorista', discountPercent: -15 };
const listCero: PriceList = { id: 'list_cero', discountPercent: 0 };
const listTotal: PriceList = { id: 'list_total', discountPercent: 100 };

const pmConDescuento: PaymentMethodConfig = { id: 'efectivo', linkedPriceListId: 'list_mostrador' };
const pmMayorista: PaymentMethodConfig = { id: 'transferencia', linkedPriceListId: 'list_mayorista' };
const pmCero: PaymentMethodConfig = { id: 'tarjeta', linkedPriceListId: 'list_cero' };
const pmTotal: PaymentMethodConfig = { id: 'paypal', linkedPriceListId: 'list_total' };
const pmSinLista: PaymentMethodConfig = { id: 'mercado_pago' };

const allLists = [listDescuento, listMayorista, listCero, listTotal];
const allPMs = [pmConDescuento, pmMayorista, pmCero, pmTotal, pmSinLista];

describe('price list adjustment calculation', () => {
  it('descuento 10% sobre $1000 devuelve -$100 (se resta del total)', () => {
    const adjustment = calcPriceListAdjustment(1000, 'efectivo', allPMs, allLists);
    // adjustmentAmount = 1000 * 10 / 100 = 100 (positive = descuento, se resta afuera)
    expect(adjustment).toBe(100);
  });

  it('recargo -15% sobre $1000 devuelve -$150 (valor negativo, al restarlo suma al total)', () => {
    const adjustment = calcPriceListAdjustment(1000, 'transferencia', allPMs, allLists);
    // adjustmentAmount = 1000 * (-15) / 100 = -150
    expect(adjustment).toBe(-150);
  });

  it('discountPercent 0% devuelve $0 (sin efecto)', () => {
    const adjustment = calcPriceListAdjustment(1000, 'tarjeta', allPMs, allLists);
    expect(adjustment).toBe(0);
  });

  it('discountPercent 100% sobre $1000 devuelve $1000 (precio gratis)', () => {
    const adjustment = calcPriceListAdjustment(1000, 'paypal', allPMs, allLists);
    expect(adjustment).toBe(1000);
  });

  it('cartTotal $0 devuelve $0 sin importar el porcentaje', () => {
    expect(calcPriceListAdjustment(0, 'efectivo', allPMs, allLists)).toBe(0);
    expect(calcPriceListAdjustment(0, 'transferencia', allPMs, allLists)).toBe(0);
  });

  it('sin linkedPriceListId en el método de pago → adjustment = 0', () => {
    const adjustment = calcPriceListAdjustment(1000, 'mercado_pago', allPMs, allLists);
    expect(adjustment).toBe(0);
  });

  it('cobro dividido (método sin lista) → adjustment = 0 (no aplica lista de precios)', () => {
    // "cobro dividido" en este sistema se modela como método sin linkedPriceListId
    const pmsDividido: PaymentMethodConfig[] = [{ id: 'cobro_dividido' }];
    const adjustment = calcPriceListAdjustment(5000, 'cobro_dividido', pmsDividido, allLists);
    expect(adjustment).toBe(0);
  });

  it('redondea a 2 decimales correctamente', () => {
    // $333.33 * 10% = 33.333 → redondeado a 33.33
    const listDiez: PriceList = { id: 'l10', discountPercent: 10 };
    const pm: PaymentMethodConfig = { id: 'pm1', linkedPriceListId: 'l10' };
    const adjustment = calcPriceListAdjustment(333.33, 'pm1', [pm], [listDiez]);
    expect(adjustment).toBe(33.33);
  });
});
