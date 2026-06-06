export const DEFAULT_TAX_RATE = 21.0;

export const TAX_EXEMPT_RATE = 0;

export const REDUCED_TAX_RATE = 10.5;

export function calculateTaxAmount(netAmount: number, taxRate: number = DEFAULT_TAX_RATE): number {
  const rate = taxRate / 100;
  return Math.round((netAmount * rate + Number.EPSILON) * 100) / 100;
}

export function calculateGrossAmount(
  netAmount: number,
  taxRate: number = DEFAULT_TAX_RATE,
): number {
  const tax = calculateTaxAmount(netAmount, taxRate);
  return Math.round((netAmount + tax + Number.EPSILON) * 100) / 100;
}

export function calculateItemTotal(
  quantity: number,
  unitPrice: number,
  discount: number = 0,
  taxRate: number = DEFAULT_TAX_RATE,
): { netAmount: number; discountAmount: number; taxAmount: number; total: number } {
  const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
  const discountAmount =
    Math.round((lineTotal * (discount / 100) + Number.EPSILON) * 100) / 100;
  const netAmount =
    Math.round((lineTotal - discountAmount + Number.EPSILON) * 100) / 100;
  const taxAmount = calculateTaxAmount(netAmount, taxRate);
  const total =
    Math.round((netAmount + taxAmount + Number.EPSILON) * 100) / 100;

  return { netAmount, discountAmount, taxAmount, total };
}

export function calculateSaleTotals(items: Array<{ quantity: number; unitPrice: number; discount?: number; taxRate?: number }>): {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
} {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let total = 0;

  for (const item of items) {
    const calculated = calculateItemTotal(
      item.quantity,
      item.unitPrice,
      item.discount ?? 0,
      item.taxRate ?? DEFAULT_TAX_RATE,
    );
    subtotal = Math.round((subtotal + calculated.netAmount + calculated.discountAmount + Number.EPSILON) * 100) / 100;
    discountTotal = Math.round((discountTotal + calculated.discountAmount + Number.EPSILON) * 100) / 100;
    taxTotal = Math.round((taxTotal + calculated.taxAmount + Number.EPSILON) * 100) / 100;
    total = Math.round((total + calculated.total + Number.EPSILON) * 100) / 100;
  }

  return { subtotal, discountTotal, taxTotal, total };
}
