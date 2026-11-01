/**
 * ============================================================================
 * Document Types (Comprobantes AFIP/ARCA y Operativos)
 * @medialunas/shared
 * ============================================================================
 *
 * Catálogo completo de los 15 tipos de comprobantes formales argentinos:
 *   1. Tickets: ticket
 *   2. Facturas: factura_a, factura_b, factura_c, factura_m
 *   3. Notas de Crédito: nota_credito_a, nota_credito_b, nota_credito_c, nota_credito_m
 *   4. Notas de Débito: nota_debito_a, nota_debito_b, nota_debito_c, nota_debito_m
 *   5. No fiscales / Operativos: presupuesto, remito
 */

export const DOCUMENT_TYPES = [
  "ticket",
  "factura_a",
  "factura_b",
  "factura_c",
  "factura_m",
  "nota_credito_a",
  "nota_credito_b",
  "nota_credito_c",
  "nota_credito_m",
  "nota_debito_a",
  "nota_debito_b",
  "nota_debito_c",
  "nota_debito_m",
  "presupuesto",
  "remito",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type SaleDocumentType = DocumentType;

export const INVOICE_DOCUMENT_TYPES = [
  "factura_a",
  "factura_b",
  "factura_c",
  "factura_m",
] as const;
export type InvoiceDocumentType = (typeof INVOICE_DOCUMENT_TYPES)[number];

export const CREDIT_NOTE_DOCUMENT_TYPES = [
  "nota_credito_a",
  "nota_credito_b",
  "nota_credito_c",
  "nota_credito_m",
] as const;
export type CreditNoteDocumentType = (typeof CREDIT_NOTE_DOCUMENT_TYPES)[number];

export const DEBIT_NOTE_DOCUMENT_TYPES = [
  "nota_debito_a",
  "nota_debito_b",
  "nota_debito_c",
  "nota_debito_m",
] as const;
export type DebitNoteDocumentType = (typeof DEBIT_NOTE_DOCUMENT_TYPES)[number];

export const FISCAL_DOCUMENT_TYPES = [
  "factura_a",
  "factura_b",
  "factura_c",
  "factura_m",
  "nota_credito_a",
  "nota_credito_b",
  "nota_credito_c",
  "nota_credito_m",
  "nota_debito_a",
  "nota_debito_b",
  "nota_debito_c",
  "nota_debito_m",
] as const;
export type FiscalDocumentType = (typeof FISCAL_DOCUMENT_TYPES)[number];

export const NON_FISCAL_DOCUMENT_TYPES = [
  "presupuesto",
  "remito",
] as const;
export type NonFiscalDocumentType = (typeof NON_FISCAL_DOCUMENT_TYPES)[number];

export const TICKET_DOCUMENT_TYPES = [
  "ticket",
] as const;

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ticket: "Ticket",
  factura_a: "Factura A",
  factura_b: "Factura B",
  factura_c: "Factura C",
  factura_m: "Factura M",
  nota_credito_a: "Nota de Crédito A",
  nota_credito_b: "Nota de Crédito B",
  nota_credito_c: "Nota de Crédito C",
  nota_credito_m: "Nota de Crédito M",
  nota_debito_a: "Nota de Débito A",
  nota_debito_b: "Nota de Débito B",
  nota_debito_c: "Nota de Débito C",
  nota_debito_m: "Nota de Débito M",
  presupuesto: "Presupuesto",
  remito: "Remito",
};

/** Comprobantes formales que exigen CUIT del cliente (tipos A y M) */
export const REQUIRES_CUIT_DOCUMENT_TYPES = [
  "factura_a",
  "factura_m",
  "nota_credito_a",
  "nota_credito_m",
  "nota_debito_a",
  "nota_debito_m",
] as const;

export function isDocumentType(val: unknown): val is DocumentType {
  return typeof val === "string" && (DOCUMENT_TYPES as readonly string[]).includes(val as DocumentType);
}

export function isInvoiceDocumentType(val: unknown): val is InvoiceDocumentType {
  return typeof val === "string" && (INVOICE_DOCUMENT_TYPES as readonly string[]).includes(val as InvoiceDocumentType);
}

export function isCreditNoteDocumentType(val: unknown): val is CreditNoteDocumentType {
  return typeof val === "string" && (CREDIT_NOTE_DOCUMENT_TYPES as readonly string[]).includes(val as CreditNoteDocumentType);
}

export function isDebitNoteDocumentType(val: unknown): val is DebitNoteDocumentType {
  return typeof val === "string" && (DEBIT_NOTE_DOCUMENT_TYPES as readonly string[]).includes(val as DebitNoteDocumentType);
}

export function isFiscalDocumentType(val: unknown): val is FiscalDocumentType {
  return typeof val === "string" && (FISCAL_DOCUMENT_TYPES as readonly string[]).includes(val as FiscalDocumentType);
}

export function isNonFiscalDocumentType(val: unknown): val is NonFiscalDocumentType {
  return typeof val === "string" && (NON_FISCAL_DOCUMENT_TYPES as readonly string[]).includes(val as NonFiscalDocumentType);
}

export function requiresCuit(docType: DocumentType | string): boolean {
  return (REQUIRES_CUIT_DOCUMENT_TYPES as readonly string[]).includes(docType);
}
