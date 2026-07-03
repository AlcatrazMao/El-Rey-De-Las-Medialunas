import type { ThermalPrinter } from 'node-thermal-printer';

import type { PrintSale, TicketStyle } from './types';

/** Ancho de ticket térmico estándar 80mm, en puntos PDF (72pt = 1in). */
export const RECEIPT_PDF_WIDTH_PT = 227;
/** "Factura" en hoja angosta tipo A5/ticket largo, más ancha que el ticket 80mm. */
export const INVOICE_PDF_WIDTH_PT = 525;

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
  const extraLines = (sale.customerDoc ? 1 : 0) + (sale.discountAmount ? 1 : 0) + (sale.surchargeAmount ? 1 : 0);
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
  center(isReceipt ? 'TICKET DE COMPRA' : 'FACTURA', baseSize + 1, true);
  y += 4;
  divider();

  row('Nro Comp:', sale.invoiceNumber);
  row('Fecha:', datePart);
  row('Cajero:', sale.operatorName);
  if (timePart) row('Hora:', timePart);
  row('Cliente:', sale.customerName || 'Consumidor Final');
  if (sale.customerDoc) row('Doc/CUIT:', sale.customerDoc);

  divider();

  setFont(true);
  doc.text('Detalle', marginX, y, { width: contentWidth - 70, lineBreak: false });
  doc.text('Subtotal', marginX + contentWidth - 70, y, { width: 70, align: 'right', lineBreak: false });
  y += baseSize * 1.4;
  divider();

  for (const item of sale.items) {
    const subtotal = item.price * item.quantity;
    row(`${item.name} x${item.quantity}`, `$${subtotal.toFixed(2)}`);
  }

  divider();

  const subtotalNeto = sale.total - sale.tax;
  row('Subtotal Neto:', `$${subtotalNeto.toFixed(2)}`);
  row('IVA:', `$${sale.tax.toFixed(2)}`);
  if (sale.discountAmount && sale.discountAmount > 0) {
    row(`Descuento (-${sale.discountPercent ?? 0}%):`, `-$${sale.discountAmount.toFixed(2)}`);
  }
  if (sale.surchargeAmount && sale.surchargeAmount > 0) {
    row(`Recargo (+${sale.surchargePercent ?? 0}%):`, `+$${sale.surchargeAmount.toFixed(2)}`);
  }
  y += 2;
  row('TOTAL:', `$${sale.total.toFixed(2)}`, true, baseSize + 2);
  y += 2;
  row('Forma de Pago:', `${formatPaymentMethod(sale.paymentMethod)} (${sale.paymentStatus.toUpperCase()})`, false, baseSize - 1);

  divider();
  center('¡Gracias por su compra!', baseSize - 1);
}

/**
 * Arma el ticket/factura directamente sobre una instancia de ThermalPrinter
 * (node-thermal-printer) usando sus comandos ESC/POS de alto nivel
 * (println/leftRight/drawLine/cut, etc.). El caller es responsable de crear
 * la instancia (con la interfaz/driver correctos) y de llamar `execute()`.
 */
export function buildThermalTicket(printer: ThermalPrinter, sale: PrintSale, style: TicketStyle): void {
  const isReceipt = style === 'receipt';
  const { datePart, timePart } = splitDateTime(sale.date);

  printer.alignCenter();
  printer.bold(true);
  printer.println('El Rey De Las Medialunas');
  printer.bold(false);
  printer.println(isReceipt ? 'TICKET DE COMPRA' : 'FACTURA');
  printer.drawLine();

  printer.alignLeft();
  printer.leftRight('Nro Comp:', sale.invoiceNumber);
  printer.leftRight('Fecha:', datePart);
  printer.leftRight('Cajero:', sale.operatorName);
  if (timePart) printer.leftRight('Hora:', timePart);
  printer.leftRight('Cliente:', sale.customerName || 'Consumidor Final');
  if (sale.customerDoc) printer.leftRight('Doc/CUIT:', sale.customerDoc);
  printer.drawLine();

  for (const item of sale.items) {
    const subtotal = item.price * item.quantity;
    printer.leftRight(`${item.name} x${item.quantity}`, `$${subtotal.toFixed(2)}`);
  }
  printer.drawLine();

  const subtotalNeto = sale.total - sale.tax;
  printer.leftRight('Subtotal Neto:', `$${subtotalNeto.toFixed(2)}`);
  printer.leftRight('IVA:', `$${sale.tax.toFixed(2)}`);
  if (sale.discountAmount && sale.discountAmount > 0) {
    printer.leftRight(`Descuento (-${sale.discountPercent ?? 0}%):`, `-$${sale.discountAmount.toFixed(2)}`);
  }
  if (sale.surchargeAmount && sale.surchargeAmount > 0) {
    printer.leftRight(`Recargo (+${sale.surchargePercent ?? 0}%):`, `+$${sale.surchargeAmount.toFixed(2)}`);
  }

  printer.bold(true);
  printer.leftRight('TOTAL:', `$${sale.total.toFixed(2)}`);
  printer.bold(false);
  printer.leftRight('Pago:', `${formatPaymentMethod(sale.paymentMethod)} (${sale.paymentStatus.toUpperCase()})`);
  printer.drawLine();

  printer.alignCenter();
  printer.println('¡Gracias por su compra!');
  printer.cut();
}
