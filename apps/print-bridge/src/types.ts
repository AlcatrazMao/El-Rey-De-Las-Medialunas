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

/**
 * Los 7 tipos de comprobante emitibles (change "Document Types / Comprobantes").
 * Ver `workers/api/src/routes/sales.ts` (y credit-notes.ts/remitos.ts/budgets.ts)
 * del lado del backend, que es quien decide y envía este valor.
 */
export type DocumentType =
  | 'ticket'
  | 'factura_a'
  | 'factura_b'
  | 'factura_c'
  | 'nota_credito'
  | 'remito'
  | 'presupuesto';

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
  /**
   * Tipo de comprobante real emitido. Determina el template/label a usar en
   * `ticket-format.ts` y si corresponde renderizar `fiscal_disclaimer`.
   */
  document_type: DocumentType;
  /**
   * Número correlativo POR TIPO Y SUCURSAL (`document_sequences`, ver
   * `workers/api/src/lib/document-sequences.ts::nextSequence`), NO confundir
   * con `sale_number`/`invoiceNumber` (contador legacy global de `sales`).
   * Este es el número real a mostrar/imprimir como identificador del
   * comprobante. Se acepta `string | number`: el backend devuelve un
   * `number` crudo (INTEGER de `RETURNING last_number`), pero el POS puede
   * optar por mandarlo ya formateado (ej. con ceros a la izquierda) como
   * `string` — el bridge no impone el formato, solo lo imprime tal cual.
   */
  document_number: string | number;
  /**
   * Leyenda fiscal libre (ej. "SIN VALOR FISCAL — CAE PENDIENTE"), armada por
   * el backend/frontend. Solo debe renderizarse para factura_a/b/c — ver
   * `ticket-format.ts`, que valida `document_type` explícitamente antes de
   * imprimirla y la ignora para el resto de los tipos aunque venga seteada.
   */
  fiscal_disclaimer?: string;
  /** Fecha de validez del presupuesto (solo aplica a `document_type: 'presupuesto'`). */
  valid_until?: string;
  /**
   * Referencia a la venta original (solo aplica a `document_type: 'nota_credito'`).
   * Corresponde al `document_number` (no `sale_number`) de la venta anulada/ajustada.
   */
  originalDocumentNumber?: string | number;
  /** Motivo de la nota de crédito (solo aplica a `document_type: 'nota_credito'`). */
  creditNoteReason?: string;
}

export type TicketStyle = 'receipt' | 'invoice' | 'remito' | 'presupuesto' | 'nota_credito';

export interface PrintRequestBody {
  sale: PrintSale;
  style: TicketStyle;
}

export interface PrintResponseBody {
  success: boolean;
  error?: string;
}
