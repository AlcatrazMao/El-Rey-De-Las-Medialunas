import { Sale, Ingredient, Expense } from '../types';

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
  const headers = ['Factura', 'Fecha', 'Operador', 'Cliente', 'Items', 'Subtotal', 'IVA (21%)', 'Total', 'Método Pago', 'Estado'];
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
 * Triggers a beautiful browser-level print layout formatted as an authentic ticket receipt or formal invoice.
 * Generates an iframe on the fly to print cleanly without messing up the main ERP styling!
 */
export const printTicketOrInvoice = (sale: Sale, style: 'receipt' | 'invoice' = 'receipt') => {
  const isReceipt = style === 'receipt';
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

  const dateStr = new Date(sale.date).toLocaleString('es-AR');
  const itemsRows = sale.items.map(item => `
    <tr>
      <td style="padding: 4px 0; text-align: left;">${item.name} x${item.quantity}</td>
      <td style="padding: 4px 0; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Impresión ${sale.invoiceNumber}</title>
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
          <div class="logo-text">🥐 PANADERÍA EL TRIGO DE ORO 🥐</div>
          <p style="margin: 2px 0; font-size: 11px;">Av. San Martín 1542, Buenos Aires</p>
          <p style="margin: 2px 0; font-size: 11px;">CUIT: 30-74895612-9 | Resp. Inscripto</p>
          <p style="margin: 2px 0; font-size: 11px;">Tel: (011) 4589-2314</p>
          <div style="font-size: ${isReceipt ? '13px' : '18px'}; font-weight: bold; margin: 10px 0 5px 0;">
            ${isReceipt ? 'TICKET DIGITAL DE COMPRA' : 'FACTURA ELECTRÓNICA CLASE A'}
          </div>
          <div style="font-size: 11px;">DOCUMENTO NO VÁLIDO COMO FACTURA (SIMULACIÓN ERP)</div>
        </div>
        
        <div class="divider"></div>
        
        <table class="meta-table">
          <tr>
            <td><strong>Nro Comp:</strong> ${sale.invoiceNumber}</td>
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
            <td>IVA (21.00%):</td>
            <td class="text-right">$${sale.tax.toFixed(2)}</td>
          </tr>
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
        
        <div class="text-center" style="margin-top: 20px; font-size: 11px;">
          <p style="margin: 2px 0;">¡Muchas gracias por su preferencia!</p>
          <p style="margin: 2px 0; font-weight: bold;">Conserve este comprobante para reclamos.</p>
          <p style="margin: 10px 0 0 0; font-size: 9px; color: #555;">Sincronizado vía Nube ERP Panadería v1.4.2</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  doc.open();
  doc.write(html);
  doc.close();

  // Remove the iframe after printing is dismissed
  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 30000); // 30 seconds should be plenty for print dialog to show up and dismiss
};
