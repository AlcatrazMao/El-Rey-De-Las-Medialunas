/**
 * Contrato de datos compartido con `apps/pos-pc/src/utils/exportUtils.ts`
 * (función `tryPrintViaBridge`). El bridge es un proceso Node standalone —
 * no depende del workspace de pos-pc — así que estos tipos son una copia
 * deliberada del subconjunto de campos de `Sale` que efectivamente viajan
 * en el body de `POST /print`. Si el contrato cambia del lado del POS,
 * actualizar acá también.
 */

export interface PrintSaleItem {
  name: string;
  quantity: number;
  price: number;
}

export interface PrintSale {
  id: string;
  invoiceNumber: string;
  date: string;
  items: PrintSaleItem[];
  total: number;
  tax: number;
  operatorName: string;
  customerName?: string;
  customerDoc?: string;
  paymentMethod: string;
  paymentStatus: string;
  discountPercent?: number;
  discountAmount?: number;
  surchargePercent?: number;
  surchargeAmount?: number;
}

export type TicketStyle = 'receipt' | 'invoice';

export interface PrintRequestBody {
  sale: PrintSale;
  style: TicketStyle;
}

export interface PrintResponseBody {
  success: boolean;
  error?: string;
}
