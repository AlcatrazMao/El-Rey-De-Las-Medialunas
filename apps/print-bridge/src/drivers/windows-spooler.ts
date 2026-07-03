import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import PDFDocument from 'pdfkit';
import { print as printPdf } from 'pdf-to-printer';

import { drawTicketPdf, estimateReceiptHeight, INVOICE_PDF_WIDTH_PT, RECEIPT_PDF_WIDTH_PT } from '../ticket-format';
import type { PrintSale, TicketStyle } from '../types';

/**
 * Genera un PDF del ticket/factura con pdfkit y lo manda directo (sin diálogo,
 * `silent: true`) a la impresora de Windows indicada, o a la default del
 * sistema si no se configuró `windowsPrinterName`. Usa pdf-to-printer, que
 * internamente delega en SumatraPDF (bundlado por la librería) en modo
 * `-print-to` / `-print-to-default`.
 */
export async function printViaWindowsSpooler(sale: PrintSale, style: TicketStyle, windowsPrinterName: string | undefined): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `medialunas-ticket-${sale.id || 'sin-id'}-${Date.now()}.pdf`);

  try {
    await generateTicketPdf(tmpFile, sale, style);
    await printPdf(tmpFile, {
      printer: windowsPrinterName?.trim() || undefined,
      silent: true,
      printDialog: false,
    });
  } finally {
    // Best-effort: si falla el borrado del temporal no es motivo para reportar error de impresión.
    fs.promises.unlink(tmpFile).catch(() => undefined);
  }
}

function generateTicketPdf(filePath: string, sale: PrintSale, style: TicketStyle): Promise<void> {
  return new Promise((resolve, reject) => {
    const isReceipt = style === 'receipt';
    const width = isReceipt ? RECEIPT_PDF_WIDTH_PT : INVOICE_PDF_WIDTH_PT;
    const height = isReceipt ? estimateReceiptHeight(sale) : 700;

    const doc = new PDFDocument({ size: [width, height], margin: 12 });
    const stream = fs.createWriteStream(filePath);

    doc.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', () => resolve());

    doc.pipe(stream);
    drawTicketPdf(doc, sale, style);
    doc.end();
  });
}
