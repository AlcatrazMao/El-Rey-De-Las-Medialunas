import type { Sale } from '../types';

export interface SaleConfirmation {
  saleId: string;
  document_number?: string | number;
  document_type?: string;
}
export function confirmLocalSale(saleId: string, result: Omit<SaleConfirmation, 'saleId'>): void {
  window.dispatchEvent(new CustomEvent<SaleConfirmation>('sale-synced', { detail: { saleId, ...result } }));
}
export function applySaleConfirmation(sales: Sale[], confirmation: SaleConfirmation): Sale[] {
  return sales.map(sale => sale.id === confirmation.saleId ? {
    ...sale, syncFailed: false,
    documentNumber: confirmation.document_number ?? sale.documentNumber,
    documentType: (confirmation.document_type as Sale['documentType']) ?? sale.documentType,
  } : sale);
}
