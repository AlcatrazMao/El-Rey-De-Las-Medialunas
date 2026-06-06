import type { PaymentMethod } from "../types/enums";

export const PAYMENT_METHODS: Record<PaymentMethod, { label: string; icon: string }> = {
  cash: { label: "Efectivo", icon: "cash" },
  credit_card: { label: "Tarjeta de Crédito", icon: "credit-card" },
  debit_card: { label: "Tarjeta de Débito", icon: "debit-card" },
  transfer: { label: "Transferencia", icon: "transfer" },
  digital_wallet: { label: "Billetera Digital", icon: "wallet" },
};

export const PAYMENT_METHOD_LIST: PaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "transfer",
  "digital_wallet",
];
