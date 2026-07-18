import { getSettings } from '../hooks/useSettings';
import type { Sale, Ingredient, Expense } from '../types';

// Use the build-time injected app version if available, otherwise fall back to
// the local package version string so prints never go out unlabeled.
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'v0.1.0';

const DEFAULT_BRIDGE_URL = 'http://localhost:9100';
const BRIDGE_TIMEOUT_MS = 1500;

/** Leyenda obligatoria (DT-14) — SOLO para factura_a/b/c, nunca para el resto. Mismo texto que POSView. */
const FISCAL_DISCLAIMER = 'SIN VALOR FISCAL — CAE PENDIENTE';
const FISCAL_INVOICE_TYPES: NonNullable<Sale['documentType']>[] = ['factura_a', 'factura_b', 'factura_c'];

/**
 * Bug fix (review): el número de comprobante a mostrar/imprimir SIEMPRE debe
 * preferir `documentNumber` (el correlativo real por tipo+sucursal que llega
 * async del backend en `syncSaleToD1`, ver AppContext.addSale) sobre
 * `invoiceNumber` (rótulo local `PENDIENTE-XXXXXXXX` que NO es un número de
 * comprobante válido). Si `documentNumber` todavía no llegó, en vez de
 * imprimir el placeholder como si fuera el número real (lo que hacía que el
 * cliente se llevara un ticket con "PENDIENTE-XXXXXXXX" en el campo "Nro
 * Comp", sin aviso), mostramos un texto explícitamente provisorio. El cajero
 * puede reimprimir manualmente desde el modal de comprobante (que sigue
 * abierto tras la venta) una vez que la reconciliación llegue — no hace
 * falta bloquear la impresión esperando a la red (rompería el offline-first).
 */
function resolveDisplayDocumentNumber(sale: Sale): string {
  if (sale.documentNumber !== undefined && sale.documentNumber !== null && sale.documentNumber !== '') {
    return String(sale.documentNumber);
  }
  return '(pendiente de confirmación)';
}

/**
 * Mapea `Sale` (tipo interno del POS) al contrato `PrintSale` que espera
 * `apps/print-bridge` (ver `apps/print-bridge/src/types.ts`). El bridge es un
 * proceso standalone que no importa el workspace de pos-pc, así que viaja
 * como JSON plano — acá se arma explícitamente el subconjunto de campos que
 * en efecto necesita, en vez de mandar el objeto `Sale` completo tal cual.
 *
 * Change "Document Types": agrega `document_type`/`document_number` (número
 * REAL correlativo por tipo+sucursal — ver `AppContext.addSale`/`syncSaleToD1`,
 * NUNCA `sale_number` ni el rótulo legacy `invoiceNumber`) y `fiscal_disclaimer`
 * (solo seteado para factura_a/b/c, `undefined` para el resto).
 */
function buildPrintSalePayload(sale: Sale) {
  const documentType = sale.documentType ?? 'ticket';
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    date: sale.date,
    items: sale.items.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
    total: sale.total,
    tax: sale.tax,
    operatorName: sale.operatorName,
    customerName: sale.customerName,
    customerDoc: sale.customerDoc,
    paymentMethod: sale.paymentMethod,
    paymentStatus: sale.paymentStatus,
    discountPercent: sale.discountPercent,
    discountAmount: sale.discountAmount,
    surchargePercent: sale.surchargePercent,
    surchargeAmount: sale.surchargeAmount,
    document_type: documentType,
    // documentNumber puede no haber llegado aún del backend (offline-first: el
    // ticket se imprime antes de que la red confirme) — el bridge recibe un
    // texto explícitamente provisorio en ese caso, nunca el placeholder
    // `invoiceNumber` (que parece un número real pero no lo es).
    document_number: resolveDisplayDocumentNumber(sale),
    fiscal_disclaimer: FISCAL_INVOICE_TYPES.includes(documentType) ? FISCAL_DISCLAIMER : undefined,
  };
}

/**
 * Shape mínimo que ambos payloads (`buildPrintSalePayload` para ventas y
 * `buildDocumentPrintPayload` para Remito/Presupuesto/Nota de Crédito)
 * satisfacen — es lo único que `tryPrintPayloadViaBridge` necesita para
 * serializar el body de POST /print. Se tipa explícito (en vez de
 * `ReturnType<typeof buildPrintSalePayload>`) porque ese return type incluye
 * campos propios de venta (discountPercent, etc.) que el payload de
 * documentos no tiene.
 */
interface BridgePrintPayload {
  id: string;
  document_type: string;
  document_number: string | number;
  [key: string]: unknown;
}

/**
 * Intenta imprimir directo vía el servicio local apps/print-bridge (POST /print),
 * evitando el diálogo nativo de impresión del navegador. Devuelve true solo si el
 * bridge confirmó la impresión ({success: true} con status 200); devuelve false ante
 * cualquier otro escenario (deshabilitado en settings, timeout, connection refused,
 * CORS, respuesta no-OK) para que el caller caiga al fallback de window.print()
 * de forma silenciosa — el bridge es opcional y muchas PCs no lo van a tener instalado.
 */
async function tryPrintViaBridge(sale: Sale, style: 'receipt' | 'invoice'): Promise<boolean> {
  return tryPrintPayloadViaBridge(buildPrintSalePayload(sale), style);
}

/**
 * Variante genérica de `tryPrintViaBridge` que acepta un payload `PrintSale`
 * ya armado (en vez de derivarlo de un `Sale` del carrito) y cualquier
 * `TicketStyle` — usada por Remito/Presupuesto/Nota de Crédito, que no son
 * ventas y por lo tanto no tienen un `Sale` real detrás (ver
 * buildDocumentPrintPayload/printDocument más abajo).
 */
async function tryPrintPayloadViaBridge(payload: BridgePrintPayload, style: 'receipt' | 'invoice' | DocumentPrintStyle): Promise<boolean> {
  const printerSettings = getSettings().printer;
  if (!printerSettings?.useBridge) return false;

  const bridgeUrl = (printerSettings.bridgeUrl?.trim() || DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);

  try {
    const response = await fetch(`${bridgeUrl}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sale: payload, style }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
    return data?.success === true;
  } catch {
    // Timeout, connection refused, CORS, bridge no instalado, etc: fallback silencioso.
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Estilos de impresión propios de comprobantes no-venta (change "Document Types"). */
export type DocumentPrintStyle = 'remito' | 'presupuesto' | 'nota_credito';

/** Item genérico para armar el payload de impresión de Remito/Presupuesto (sin depender de `Sale`/carrito). */
export interface DocumentPrintItem {
  name: string;
  quantity: number;
  /** Remito no tiene precio (DT-8) — se manda 0 y print-bridge lo ignora (isRemito no imprime columna de precio). */
  price: number;
}

/**
 * Datos mínimos para imprimir un Remito/Presupuesto/Nota de Crédito recién
 * creado. A diferencia de `Sale`, estos documentos no pasan por el carrito
 * de venta — el caller (los modales de components/documents/) arma este
 * objeto directamente a partir de la respuesta de `useDocuments`.
 */
export interface DocumentPrintData {
  documentNumber: string | number;
  items: DocumentPrintItem[];
  operatorName: string;
  customerName?: string;
  customerDoc?: string;
  /** Presupuesto: subtotal/total ya calculados (con precio); Remito no los usa. */
  subtotal?: number;
  total?: number;
  /** Presupuesto: fecha de validez (DT-9). */
  validUntil?: string;
  /** Nota de Crédito: referencia a la venta original (DT-7). */
  originalDocumentNumber?: string | number;
  /** Nota de Crédito: motivo. */
  creditNoteReason?: string;
}

/** Arma el `PrintSale` (contrato de apps/print-bridge) para un Remito/Presupuesto/Nota de Crédito. */
function buildDocumentPrintPayload(style: DocumentPrintStyle, data: DocumentPrintData) {
  const documentType = style; // 'remito' | 'presupuesto' | 'nota_credito' — mismo valor en DocumentType.
  const total = data.total ?? 0;
  return {
    id: `${documentType}-${data.documentNumber}`,
    invoiceNumber: String(data.documentNumber),
    date: new Date().toISOString(),
    items: data.items.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
    total,
    tax: 0,
    operatorName: data.operatorName,
    customerName: data.customerName,
    customerDoc: data.customerDoc,
    paymentMethod: 'efectivo',
    paymentStatus: 'completed',
    document_type: documentType,
    document_number: data.documentNumber,
    fiscal_disclaimer: undefined,
    valid_until: data.validUntil,
    originalDocumentNumber: data.originalDocumentNumber,
    creditNoteReason: data.creditNoteReason,
  };
}

/**
 * Imprime un Remito/Presupuesto/Nota de Crédito recién creado. Mismo patrón
 * que `printTicketOrInvoice`: intenta primero el bridge local y, si no está
 * disponible, cae al fallback de `window.print()` vía iframe con el HTML
 * armado por `buildDocumentHtml`.
 */
export const printDocument = async (style: DocumentPrintStyle, data: DocumentPrintData): Promise<void> => {
  const payload = buildDocumentPrintPayload(style, data);
  const printedViaBridge = await tryPrintPayloadViaBridge(payload, style);
  if (printedViaBridge) return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc) return;

  const html = buildDocumentHtml(style, data);

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 30000);
};

const DOCUMENT_STYLE_LABELS: Record<DocumentPrintStyle, string> = {
  remito: 'REMITO',
  presupuesto: 'PRESUPUESTO',
  nota_credito: 'NOTA DE CRÉDITO',
};

/**
 * Fallback de impresión vía `window.print()` para Remito/Presupuesto/Nota de
 * Crédito (mismo espíritu que `buildTicketHtml`, pero sin IVA/descuentos —
 * estos documentos no son ventas). Remito omite precios/total (DT-8);
 * Presupuesto muestra fecha de validez; Nota de Crédito muestra referencia a
 * la venta original y motivo.
 */
function buildDocumentHtml(style: DocumentPrintStyle, data: DocumentPrintData): string {
  const isRemito = style === 'remito';
  const isPresupuesto = style === 'presupuesto';
  const isNotaCredito = style === 'nota_credito';
  const label = DOCUMENT_STYLE_LABELS[style];
  const dateStr = new Date().toLocaleString('es-AR');

  const itemsRows = data.items.map(item => `
    <tr>
      <td style="padding: 4px 0; text-align: left;">${item.name} x${item.quantity}</td>
      ${!isRemito ? `<td style="padding: 4px 0; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>` : ''}
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${label} ${data.documentNumber}</title>
      <style>
        body {
          font-family: 'Courier New', Courier, monospace;
          color: #000;
          background: #fff;
          font-size: 13px;
          line-height: 1.4;
          padding: 10px;
          max-width: 300px;
          margin: 0 auto;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .divider { border-bottom: 2px dashed #000; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; }
        .total-row td { font-weight: bold; font-size: 15px; }
        .meta-table td { padding: 2px 0; font-size: 12px; }
        .logo-text { font-size: 18px; font-weight: bold; margin-bottom: 4px; font-family: sans-serif; letter-spacing: 1px; }
      </style>
    </head>
    <body onload="window.print();">
      <div class="text-center">
        <div class="logo-text">🥐 El Rey De Las Medialunas 🥐</div>
        <div style="font-size: 13px; font-weight: bold; margin: 10px 0 5px 0;">${label}</div>
      </div>

      <div class="divider"></div>

      <table class="meta-table">
        <tr>
          <td><strong>Nro Comp:</strong> ${data.documentNumber}</td>
          <td class="text-right"><strong>Fecha:</strong> ${dateStr.split(' ')[0]}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>Operador:</strong> ${data.operatorName}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>Cliente:</strong> ${data.customerName || 'Consumidor Final'}</td>
        </tr>
        ${data.customerDoc ? `<tr><td colspan="2"><strong>Doc/CUIT:</strong> ${data.customerDoc}</td></tr>` : ''}
        ${isNotaCredito && data.originalDocumentNumber !== undefined ? `<tr><td colspan="2"><strong>Ref. Comprobante:</strong> ${data.originalDocumentNumber}</td></tr>` : ''}
        ${isPresupuesto && data.validUntil ? `<tr><td colspan="2"><strong>Válido hasta:</strong> ${data.validUntil}</td></tr>` : ''}
      </table>

      <div class="divider"></div>

      <table>
        <thead>
          <tr>
            <th style="border-bottom: 1px solid #000; text-align: left; padding-bottom: 4px;">${isRemito ? 'Cant. / Producto' : 'Detalle'}</th>
            ${!isRemito ? '<th style="border-bottom: 1px solid #000; text-align: right; padding-bottom: 4px;">Subtotal</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="divider"></div>

      ${!isRemito ? `
      <table style="margin-top: 10px;">
        ${isNotaCredito ? `
        <tr class="total-row">
          <td style="padding-top: 8px;">MONTO:</td>
          <td class="text-right" style="padding-top: 8px;">$${(data.total ?? 0).toFixed(2)}</td>
        </tr>` : `
        <tr class="total-row">
          <td style="padding-top: 8px;">TOTAL:</td>
          <td class="text-right" style="padding-top: 8px;">$${(data.total ?? 0).toFixed(2)}</td>
        </tr>`}
        ${isNotaCredito && data.creditNoteReason ? `
        <tr>
          <td colspan="2" style="font-size: 11px; padding-top: 8px;"><strong>Motivo:</strong> ${data.creditNoteReason}</td>
        </tr>` : ''}
      </table>
      <div class="divider"></div>` : ''}

      <div class="text-center" style="margin-top: 20px; font-size: 11px;">
        ${isPresupuesto ? '<p style="margin: 2px 0;">Este documento NO constituye una venta.</p>' : ''}
        ${isRemito ? '<p style="margin: 2px 0;">Recibí conforme la mercadería detallada.</p><p style="margin: 2px 0; font-weight: bold;">Documento sin valor fiscal ni comercial.</p>' : ''}
        <p style="margin: 10px 0 0 0; font-size: 9px; color: #555;">Sincronizado vía Nube ERP Panadería ${APP_VERSION}</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Downloads arbitrary structural rows as a clean CSV file
 */
export const downloadCSV = (headers: string[], rows: string[][], filename: string) => {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => 
      row.map(cell => {
        // Escape quotes and commas
        const formatted = String(cell).replace(/"/g, '""');
        return formatted.includes(',') || formatted.includes('\n') || formatted.includes('"') 
          ? `"${formatted}"` 
          : formatted;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportSalesToCSV = (sales: Sale[]) => {
  const ivaPct = (getSettings().fiscal.ivaRate * 100).toFixed(0);
  const headers = ['Factura', 'Fecha', 'Operador', 'Cliente', 'Items', 'Subtotal', `IVA (${ivaPct}%)`, 'Total', 'Método Pago', 'Estado'];
  const rows = sales.map(s => [
    s.invoiceNumber,
    new Date(s.date).toLocaleString('es-AR'),
    s.operatorName,
    s.customerName || 'Consumidor Final',
    s.items.map(i => `${i.name} (x${i.quantity})`).join(' | '),
    (s.total - s.tax).toFixed(2),
    s.tax.toFixed(2),
    s.total.toFixed(2),
    s.paymentMethod.replace('_', ' ').toUpperCase(),
    s.paymentStatus.toUpperCase()
  ]);
  downloadCSV(headers, rows, `ventas_panaderia_${new Date().toISOString().slice(0,10)}`);
};

export const exportIngredientsToCSV = (ingredients: Ingredient[]) => {
  const headers = ['ID', 'Insumo', 'Stock Actual', 'Unidad', 'Umbral Mínimo', 'Costo Unitario ($)', 'Valorización ($)'];
  const rows = ingredients.map(i => [
    i.id,
    i.name,
    i.stock.toFixed(2),
    i.unit,
    i.minStock.toString(),
    i.unitCost.toFixed(2),
    (i.stock * i.unitCost).toFixed(2)
  ]);
  downloadCSV(headers, rows, `inventario_insumos_${new Date().toISOString().slice(0,10)}`);
};

export const exportExpensesToCSV = (expenses: Expense[]) => {
  const headers = ['ID', 'Concepto', 'Categoría', 'Monto ($)', 'Fecha', 'Método Pago'];
  const rows = expenses.map(e => [
    e.id,
    e.concept,
    e.category.toUpperCase(),
    e.amount.toFixed(2),
    new Date(e.date).toLocaleString('es-AR'),
    e.paymentMethod
  ]);
  downloadCSV(headers, rows, `gastos_panaderia_${new Date().toISOString().slice(0,10)}`);
};

/**
 * Arma el HTML completo (documento standalone, con estilos inline) de un ticket/factura
 * para una venta dada. Factorizado desde printTicketOrInvoice para poder reusarlo tanto
 * en el iframe de impresión como en la exportación a archivo .html descargable
 * (ver downloadTicketHtml) sin duplicar el armado del comprobante.
 */
export const buildTicketHtml = (sale: Sale, style: 'receipt' | 'invoice' = 'receipt'): string => {
  const isReceipt = style === 'receipt';
  const ivaRate = getSettings().fiscal.ivaRate;
  const ivaPct = (ivaRate * 100).toFixed(2);
  // Preferimos el número REAL (documentNumber) sobre el placeholder legacy
  // invoiceNumber — ver resolveDisplayDocumentNumber. Si todavía no llegó,
  // el comprobante impreso deja explícito que es provisorio en vez de mostrar
  // "PENDIENTE-XXXXXXXX" como si fuera un número de comprobante válido.
  const displayDocNumber = resolveDisplayDocumentNumber(sale);
  // DT-14 fix: este fallback de impresión (window.print(), cuando no hay
  // print-bridge instalado) no incluía la leyenda fiscal — solo aparecía en
  // el modal en pantalla y en el bridge (ver ticket-format.ts). Mismo
  // criterio que el resto del código: únicamente factura_a/b/c, nunca el
  // resto de los tipos (ticket/remito/presupuesto/nota_credito).
  const documentType = sale.documentType ?? 'ticket';
  const showFiscalDisclaimer = FISCAL_INVOICE_TYPES.includes(documentType);

  const dateStr = new Date(sale.date).toLocaleString('es-AR');
  const itemsRows = sale.items.map(item => `
    <tr>
      <td style="padding: 4px 0; text-align: left;">${item.name} x${item.quantity}</td>
      <td style="padding: 4px 0; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Impresión ${displayDocNumber}</title>
      <style>
        body {
          font-family: 'Courier New', Courier, monospace;
          color: #000;
          background: #fff;
          font-size: 13px;
          line-height: 1.4;
          padding: ${isReceipt ? '10px' : '40px'};
          max-width: ${isReceipt ? '300px' : '700px'};
          margin: 0 auto;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .divider { border-bottom: 2px dashed #000; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; }
        .total-row td { font-weight: bold; font-size: 15px; }
        .meta-table td { padding: 2px 0; font-size: 12px; }
        .logo-text { font-size: ${isReceipt ? '18px' : '26px'}; font-weight: bold; margin-bottom: 4px; font-family: sans-serif; letter-spacing: 1px; }
        .invoice-box {
          border: ${isReceipt ? 'none' : '1px solid #ddd'};
          padding: ${isReceipt ? '0' : '20px'};
          border-radius: ${isReceipt ? '0' : '8px'};
        }
      </style>
    </head>
    <body onload="window.print();">
      <div class="invoice-box">
        <div class="text-center">
          <div class="logo-text">🥐 El Rey De Las Medialunas 🥐</div>
          <p style="margin: 2px 0; font-size: 11px;">CUIT: 30-00000000-0 · IVA Resp. Inscripto</p>
          <div style="font-size: ${isReceipt ? '13px' : '18px'}; font-weight: bold; margin: 10px 0 5px 0;">
            ${isReceipt ? 'TICKET DIGITAL DE COMPRA' : 'FACTURA ELECTRÓNICA CLASE A'}
          </div>
          <div style="font-size: 11px;">DOCUMENTO NO VÁLIDO COMO FACTURA (SIMULACIÓN ERP)</div>
        </div>
        
        <div class="divider"></div>
        
        <table class="meta-table">
          <tr>
            <td><strong>Nro Comp:</strong> ${displayDocNumber}</td>
            <td class="text-right"><strong>Fecha:</strong> ${dateStr.split(' ')[0]}</td>
          </tr>
          <tr>
            <td><strong>Cajero:</strong> ${sale.operatorName}</td>
            <td class="text-right"><strong>Hora:</strong> ${dateStr.split(' ')[1] || ''}</td>
          </tr>
          <tr>
            <td colspan="2"><strong>Cliente:</strong> ${sale.customerName || 'Consumidor Final'}</td>
          </tr>
          ${sale.customerDoc ? `<tr><td colspan="2"><strong>Doc/CUIT:</strong> ${sale.customerDoc}</td></tr>` : ''}
        </table>
        
        <div class="divider"></div>
        
        <table>
          <thead>
            <tr>
              <th style="border-bottom: 1px solid #000; text-align: left; padding-bottom: 4px;">Detalle</th>
              <th style="border-bottom: 1px solid #000; text-align: right; padding-bottom: 4px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
        
        <div class="divider"></div>
        
        <table style="margin-top: 10px;">
          <tr>
            <td>Subtotal Neto:</td>
            <td class="text-right">$${(sale.total - sale.tax).toFixed(2)}</td>
          </tr>
          <tr>
            <td>IVA (${ivaPct}%):</td>
            <td class="text-right">$${sale.tax.toFixed(2)}</td>
          </tr>
          ${sale.discountAmount && sale.discountAmount > 0 ? `
          <tr>
            <td>Descuento (-${sale.discountPercent ?? 0}%):</td>
            <td class="text-right">- $${sale.discountAmount.toFixed(2)}</td>
          </tr>` : ''}
          ${sale.surchargeAmount && sale.surchargeAmount > 0 ? `
          <tr>
            <td>Recargo (+${sale.surchargePercent ?? 0}%):</td>
            <td class="text-right">+ $${sale.surchargeAmount.toFixed(2)}</td>
          </tr>` : ''}
          <tr class="total-row">
            <td style="padding-top: 8px;">TOTAL:</td>
            <td class="text-right" style="padding-top: 8px;">$${sale.total.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="font-size: 11px; padding-top: 10px;">Forma de Pago:</td>
            <td class="text-right" style="font-size: 11px; padding-top: 10px; font-weight: bold;">
              ${sale.paymentMethod.replace('_', ' ').toUpperCase()} (${sale.paymentStatus.toUpperCase()})
            </td>
          </tr>
        </table>
        
        <div class="divider"></div>

        ${showFiscalDisclaimer ? `
        <div class="text-center" style="font-size: 12px; font-weight: bold; margin: 4px 0;">${FISCAL_DISCLAIMER}</div>
        <div class="divider"></div>
        ` : ''}

        <div class="text-center" style="margin-top: 20px; font-size: 11px;">
          <p style="margin: 2px 0;">¡Muchas gracias por su preferencia!</p>
          <p style="margin: 2px 0; font-weight: bold;">Conserve este comprobante para reclamos.</p>
          <p style="margin: 10px 0 0 0; font-size: 9px; color: #555;">Sincronizado vía Nube ERP Panadería ${APP_VERSION}</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Triggers a beautiful browser-level print layout formatted as an authentic ticket receipt or formal invoice.
 * Generates an iframe on the fly to print cleanly without messing up the main ERP styling!
 *
 * Primero intenta imprimir vía el bridge local de impresión directa (apps/print-bridge, ver
 * tryPrintViaBridge). Si está deshabilitado en settings o no responde, cae de forma transparente
 * al comportamiento de siempre (iframe + window.print()) — ningún caller necesita saber cuál de
 * los dos caminos se usó.
 */
export const printTicketOrInvoice = async (sale: Sale, style: 'receipt' | 'invoice' = 'receipt'): Promise<void> => {
  const printedViaBridge = await tryPrintViaBridge(sale, style);
  if (printedViaBridge) return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc) return;

  const html = buildTicketHtml(sale, style);

  doc.open();
  doc.write(html);
  doc.close();

  // Remove the iframe after printing is dismissed
  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 30000); // 30 seconds should be plenty for print dialog to show up and dismiss
};

/**
 * Exporta el ticket/factura de una venta como archivo .html descargable, reusando el mismo
 * armado de comprobante que printTicketOrInvoice (ver buildTicketHtml). No requiere librerías
 * de PDF: el usuario puede abrir el .html en el navegador e imprimirlo o "Guardar como PDF"
 * desde el diálogo de impresión nativo. Mismo patrón Blob + URL.createObjectURL + <a download>
 * que downloadCSV.
 */
export const downloadTicketHtml = (sale: Sale, style: 'receipt' | 'invoice' = 'receipt'): void => {
  const html = buildTicketHtml(sale, style);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `ticket-${sale.invoiceNumber}.html`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
