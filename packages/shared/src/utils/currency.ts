const ARS_LOCALE = "es-AR";

const ARS_FORMATTER = new Intl.NumberFormat(ARS_LOCALE, {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return ARS_FORMATTER.format(amount);
}

export function formatCurrencyNoSymbol(amount: number): string {
  return amount.toLocaleString(ARS_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^0-9,-]/g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

export function roundCurrency(amount: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(amount * factor) / factor;
}
