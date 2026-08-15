import type { ThermalPrinter } from 'node-thermal-printer';

import type { DocumentType, PrintSale, TicketStyle } from './types';

/** Ancho de ticket térmico estándar 80mm, en puntos PDF (72pt = 1in). */
export const RECEIPT_PDF_WIDTH_PT = 227;
/** "Factura" en hoja angosta tipo A5/ticket largo, más ancha que el ticket 80mm. */
export const INVOICE_PDF_WIDTH_PT = 525;

/**
 * Label visible por tipo de comprobante (reemplaza el hardcode previo
 * 'FACTURA' / 'TICKET DE COMPRA' basado solo en `style`). `document_type` es
 * la fuente de verdad real del tipo — `style` sigue existiendo para decidir
 * layout/ancho (receipt angosto vs invoice ancho), no para el label.
 */
const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ticket: 'TICKET DE COMPRA',
  factura_a: 'FACTURA A',
  factura_b: 'FACTURA B',
  factura_c: 'FACTURA C',
  nota_credito: 'NOTA DE CRÉDITO',
  remito: 'REMITO',
  presupuesto: 'PRESUPUESTO',
};

/** Tipos de comprobante fiscal (factura). Únicos donde puede aparecer `fiscal_disclaimer`. */
const FISCAL_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set(['factura_a', 'factura_b', 'factura_c']);

function documentTypeLabel(documentType: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[documentType];
}

/**
 * Determina si corresponde renderizar `fiscal_disclaimer`. Valida
 * explícitamente `document_type` (no confía en que el campo venga vacío por
 * las dudas) — solo factura_a/b/c pueden mostrarlo; para el resto de los
 * tipos el disclaimer NUNCA se imprime aunque venga seteado por error.
 */
function shouldShowFiscalDisclaimer(sale: PrintSale): boolean {
  return FISCAL_DOCUMENT_TYPES.has(sale.document_type) && Boolean(sale.fiscal_disclaimer?.trim());
}

function formatPaymentMethod(method: string): string {
  return method.replace(/_/g, ' ').toUpperCase();
}

function splitDateTime(isoDate: string): { datePart: string; timePart: string } {
  const dateStr = new Date(isoDate).toLocaleString('es-AR');
  const [datePart, timePart] = dateStr.split(' ');
  return { datePart: datePart ?? dateStr, timePart: timePart ?? '' };
}

/**
 * Estima el alto necesario del PDF del ticket (estilo receipt, rollo angosto)
 * en base a la cantidad de líneas que vamos a escribir, para no cortar
 * contenido ni dejar un PDF de una sola página gigante y vacío.
 */
export function estimateReceiptHeight(sale: PrintSale): number {
  const HEADER_FOOTER_LINES = 16; // título, meta, encabezado de tabla, totales, footer, dividers
  const extraLines =
    (sale.customerDoc ? 1 : 0) +
    (sale.discountAmount ? 1 : 0) +
    (sale.surchargeAmount ? 1 : 0) +
    (shouldShowFiscalDisclaimer(sale) ? 3 : 0) + // separador + leyenda (puede wrappear) + separador
    (sale.document_type === 'presupuesto' && sale.valid_until ? 1 : 0) +
    (sale.document_type === 'nota_credito' ? 2 : 0); // referencia a venta original + motivo
  const lineHeight = 13;
  const margins = 60;
  const minHeight = 320;
  return Math.max(minHeight, (HEADER_FOOTER_LINES + extraLines + sale.items.length) * lineHeight + margins);
}

/**
 * Arma el ticket/factura en un PDFDocument (pdfkit) usando texto monoespaciado
 * (Courier), para el driver windows-spooler. No usa `doc.y` automático para el
 * layout de dos columnas (izquierda/derecha) porque pdfkit no tiene un helper
 * nativo tipo `leftRight`; se maneja el cursor `y` a mano.
 */
export function drawTicketPdf(doc: PDFKit.PDFDocument, sale: PrintSale, style: TicketStyle): void {
  const isReceipt = style === 'receipt';
  const isRemito = sale.document_type === 'remito';
  const isPresupuesto = sale.document_type === 'presupuesto';
  const isNotaCredito = sale.document_type === 'nota_credito';
  const custom = sale.customization;
  const showPrices = custom?.show_prices !== false;
  const showTax = custom?.show_tax !== false;
  const showCustomer = custom?.show_customer !== false;
  const showOperator = custom?.show_operator !== false;
  const marginX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const baseSize = isReceipt ? 8 : 10;
  const titleSize = isReceipt ? 12 : 16;
  let y = doc.page.margins.top;

  const setFont = (bold: boolean, size = baseSize): void => {
    doc.font(bold ? 'Courier-Bold' : 'Courier').fontSize(size);
  };

  const center = (text: string, size = baseSize, bold = false): void => {
    setFont(bold, size);
    doc.text(text, marginX, y, { width: contentWidth, align: 'center' });
    y = doc.y + 2;
  };

  const divider = (): void => {
    doc.moveTo(marginX, y).lineTo(marginX + contentWidth, y).dash(1, { space: 1 }).strokeColor('#000000').stroke();
    doc.undash();
    y += 6;
  };

  const row = (left: string, right: string, bold = false, size = baseSize): void => {
    setFont(bold, size);
    const rightWidth = doc.widthOfString(right);
    doc.text(left, marginX, y, { width: contentWidth - rightWidth - 6, lineBreak: false });
    doc.text(right, marginX + contentWidth - rightWidth, y, { lineBreak: false });
    y += size * 1.4;
  };

  const { datePart, timePart } = splitDateTime(sale.date);

  center('El Rey De Las Medialunas', titleSize, true);
  center(custom?.title?.trim() || documentTypeLabel(sale.document_type), baseSize + 1, true);
  if (custom?.header_text?.trim()) {
    y += 2;
    center(custom.header_text.trim(), baseSize - 1);
  }
  y += 4;
  divider();

  row('Nro Comp:', String(sale.document_number));
  row('Fecha:', datePart);
  if (showOperator) row('Cajero:', sale.operatorName);
  if (timePart) row('Hora:', timePart);
  if (showCustomer) {
    row('Cliente:', sale.customerName || 'Consumidor Final');
    if (sale.customerDoc) row('Doc/CUIT:', sale.customerDoc);
  }
  if (isNotaCredito && sale.originalDocumentNumber !== undefined) {
    row('Ref. Comprobante:', String(sale.originalDocumentNumber));
  }
  if (isPresupuesto && sale.valid_until) {
    row('Válido hasta:', sale.valid_until);
  }

  divider();

  if (isRemito) {
    // Remito: sin precios, solo cantidad + descripción/producto (DT-8).
    setFont(true);
    doc.text('Cant.', marginX, y, { width: 50, lineBreak: false });
    doc.text('Producto / Descripción', marginX + 50, y, { width: contentWidth - 50, lineBreak: false });
    y += baseSize * 1.4;
    divider();

    for (const item of sale.items) {
      setFont(false);
      doc.text(`${item.quantity}`, marginX, y, { width: 50, lineBreak: false });
      doc.text(item.name, marginX + 50, y, { width: contentWidth - 50, lineBreak: false });
      y += baseSize * 1.4;
    }

    divider();
    center('Documento sin valor fiscal ni comercial.', baseSize - 1);
  } else {
    setFont(true);
    doc.text('Detalle', marginX, y, { width: contentWidth - 70, lineBreak: false });
    if (showPrices) {
      doc.text('Subtotal', marginX + contentWidth - 70, y, { width: 70, align: 'right', lineBreak: false });
    }
    y += baseSize * 1.4;
    divider();

    for (const item of sale.items) {
      const subtotal = item.price * item.quantity;
      row(`${item.name} x${item.quantity}`, showPrices ? `$${subtotal.toFixed(2)}` : '');
    }

    divider();

    if (showPrices) {
      const subtotalNeto = sale.total - sale.tax;
      row('Subtotal Neto:', `$${subtotalNeto.toFixed(2)}`);
      if (showTax) row('IVA:', `$${sale.tax.toFixed(2)}`);
      if (sale.discountAmount && sale.discountAmount > 0) {
        row(`Descuento (-${sale.discountPercent ?? 0}%):`, `-$${sale.discountAmount.toFixed(2)}`);
      }
      if (sale.surchargeAmount && sale.surchargeAmount > 0) {
        row(`Recargo (+${sale.surchargePercent ?? 0}%):`, `+$${sale.surchargeAmount.toFixed(2)}`);
      }
      y += 2;
      row('TOTAL:', `$${sale.total.toFixed(2)}`, true, baseSize + 2);
    }

    if (isNotaCredito && sale.creditNoteReason) {
      y += 2;
      row('Motivo:', sale.creditNoteReason, false, baseSize - 1);
    }

    if (!isPresupuesto) {
      y += 2;
      row('Forma de Pago:', `${formatPaymentMethod(sale.paymentMethod)} (${sale.paymentStatus.toUpperCase()})`, false, baseSize - 1);
    }
  }

  if (shouldShowFiscalDisclaimer(sale)) {
    divider();
    center((sale.fiscal_disclaimer as string).toUpperCase(), baseSize, true);
    divider();
  } else {
    divider();
  }

  if (isPresupuesto) {
    center('Este documento NO constituye una venta.', baseSize - 1);
  } else if (isRemito) {
    center('Recibí conforme la mercadería detallada.', baseSize - 1);
  } else {
    center('¡Gracias por su compra!', baseSize - 1);
  }

  if (custom?.footer_text?.trim()) {
    y += 2;
    center(custom.footer_text.trim(), baseSize - 1);
  }
}

/**
 * Arma el ticket/factura directamente sobre una instancia de ThermalPrinter
 * (node-thermal-printer) usando sus comandos ESC/POS de alto nivel
 * (println/leftRight/drawLine/cut, etc.). El caller es responsable de crear
 * la instancia (con la interfaz/driver correctos) y de llamar `execute()`.
 *
 * `_style` se recibe para mantener la misma firma que `drawTicketPdf` (el
 * caller en escpos-usb.ts pasa el mismo `style` a ambas), pero acá no afecta
 * el layout: a diferencia del PDF (que varía de ancho angosto/ancho según
 * receipt/invoice), el térmico siempre imprime a una columna con el ancho
 * físico fijo del rollo conectado.
 */
export function buildThermalTicket(printer: ThermalPrinter, sale: PrintSale, _style: TicketStyle): void {
  const isRemito = sale.document_type === 'remito';
  const isPresupuesto = sale.document_type === 'presupuesto';
  const isNotaCredito = sale.document_type === 'nota_credito';
  const custom = sale.customization;
  const showPrices = custom?.show_prices !== false;
  const showTax = custom?.show_tax !== false;
  const showCustomer = custom?.show_customer !== false;
  const showOperator = custom?.show_operator !== false;
  const { datePart, timePart } = splitDateTime(sale.date);

  printer.alignCenter();
  printer.bold(true);
  printer.println('El Rey De Las Medialunas');
  printer.bold(false);
  printer.println(custom?.title?.trim() || documentTypeLabel(sale.document_type));
  if (custom?.header_text?.trim()) printer.println(custom.header_text.trim());
  printer.drawLine();

  printer.alignLeft();
  printer.leftRight('Nro Comp:', String(sale.document_number));
  printer.leftRight('Fecha:', datePart);
  if (showOperator) printer.leftRight('Cajero:', sale.operatorName);
  if (timePart) printer.leftRight('Hora:', timePart);
  if (showCustomer) {
    printer.leftRight('Cliente:', sale.customerName || 'Consumidor Final');
    if (sale.customerDoc) printer.leftRight('Doc/CUIT:', sale.customerDoc);
  }
  if (isNotaCredito && sale.originalDocumentNumber !== undefined) {
    printer.leftRight('Ref. Comprobante:', String(sale.originalDocumentNumber));
  }
  if (isPresupuesto && sale.valid_until) {
    printer.leftRight('Válido hasta:', sale.valid_until);
  }
  printer.drawLine();

  if (isRemito) {
    // Remito: sin precios, solo cantidad + descripción/producto (DT-8).
    for (const item of sale.items) {
      printer.leftRight(`${item.quantity} x`, item.name);
    }
    printer.drawLine();
    printer.alignCenter();
    printer.println('Documento sin valor fiscal ni comercial.');
    printer.alignLeft();
  } else {
    for (const item of sale.items) {
      const subtotal = item.price * item.quantity;
      printer.leftRight(`${item.name} x${item.quantity}`, showPrices ? `$${subtotal.toFixed(2)}` : '');
    }
    printer.drawLine();

    if (showPrices) {
      const subtotalNeto = sale.total - sale.tax;
      printer.leftRight('Subtotal Neto:', `$${subtotalNeto.toFixed(2)}`);
      if (showTax) printer.leftRight('IVA:', `$${sale.tax.toFixed(2)}`);
      if (sale.discountAmount && sale.discountAmount > 0) {
        printer.leftRight(`Descuento (-${sale.discountPercent ?? 0}%):`, `-$${sale.discountAmount.toFixed(2)}`);
      }
      if (sale.surchargeAmount && sale.surchargeAmount > 0) {
        printer.leftRight(`Recargo (+${sale.surchargePercent ?? 0}%):`, `+$${sale.surchargeAmount.toFixed(2)}`);
      }

      printer.bold(true);
      printer.leftRight('TOTAL:', `$${sale.total.toFixed(2)}`);
      printer.bold(false);
    }

    if (isNotaCredito && sale.creditNoteReason) {
      printer.leftRight('Motivo:', sale.creditNoteReason);
    }

    if (!isPresupuesto) {
      printer.leftRight('Pago:', `${formatPaymentMethod(sale.paymentMethod)} (${sale.paymentStatus.toUpperCase()})`);
    }
    printer.drawLine();
  }

  if (shouldShowFiscalDisclaimer(sale)) {
    printer.alignCenter();
    printer.bold(true);
    printer.println((sale.fiscal_disclaimer as string).toUpperCase());
    printer.bold(false);
    printer.drawLine();
  }

  printer.alignCenter();
  if (isPresupuesto) {
    printer.println('Este documento NO constituye una venta.');
  } else if (isRemito) {
    printer.println('Recibí conforme la mercadería detallada.');
  } else {
    printer.println('¡Gracias por su compra!');
  }
  if (custom?.footer_text?.trim()) printer.println(custom.footer_text.trim());
  printer.cut();
}
