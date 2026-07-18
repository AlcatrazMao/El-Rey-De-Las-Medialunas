import { describe, it, expect } from 'vitest';

/**
 * Test C (SDD "Document Types / Comprobantes", Fase 4) — guard de CUIT en la
 * UI de POSView.tsx antes de confirmar una venta con factura_a/b/c.
 *
 * Mismo criterio que posViewDocumentTypeSelector.test.ts: sin RTL instalado en
 * el repo, replicamos la derivación pura tal cual vive en POSView.tsx
 * (líneas 63, 1066-1067, y el `disabled` del botón de confirmar en
 * líneas 1752/2677):
 *
 *   const FISCAL_INVOICE_TYPES = ['factura_a', 'factura_b', 'factura_c'];
 *   const documentTypeNeedsCuit = FISCAL_INVOICE_TYPES.includes(documentType);
 *   const cuitMissingForInvoice = documentTypeNeedsCuit && !customerDoc.trim();
 *   // botón de confirmar:
 *   disabled={cart.length === 0 || isProcessingPayment || cuitMissingForInvoice}
 *
 * Nota (DT-7/2.7): el frontend NO es la validación autoritativa — el backend
 * (sales.ts) rechaza igual si el documento cargado no es realmente un CUIT.
 * Este test cubre solo el guard best-effort del lado UI.
 */
type DocumentType = 'ticket' | 'factura_a' | 'factura_b' | 'factura_c' | 'nota_credito' | 'remito' | 'presupuesto';

const FISCAL_INVOICE_TYPES: DocumentType[] = ['factura_a', 'factura_b', 'factura_c'];

function cuitMissingForInvoice(documentType: DocumentType, customerDoc: string): boolean {
  const documentTypeNeedsCuit = FISCAL_INVOICE_TYPES.includes(documentType);
  return documentTypeNeedsCuit && !customerDoc.trim();
}

function isConfirmDisabled(params: { cartLength: number; isProcessingPayment: boolean; documentType: DocumentType; customerDoc: string }): boolean {
  const { cartLength, isProcessingPayment, documentType, customerDoc } = params;
  return cartLength === 0 || isProcessingPayment || cuitMissingForInvoice(documentType, customerDoc);
}

describe('POSView: guard de CUIT para factura_a/b/c', () => {
  describe.each(['factura_a', 'factura_b', 'factura_c'] as DocumentType[])('%s', documentType => {
    it('sin CUIT cargado (customerDoc vacío) — bloquea la confirmación', () => {
      expect(cuitMissingForInvoice(documentType, '')).toBe(true);
      expect(isConfirmDisabled({ cartLength: 2, isProcessingPayment: false, documentType, customerDoc: '' })).toBe(true);
    });

    it('con customerDoc de solo espacios — sigue bloqueado (usa trim())', () => {
      expect(cuitMissingForInvoice(documentType, '   ')).toBe(true);
    });

    it('con CUIT cargado — NO bloquea (guard satisfecho)', () => {
      expect(cuitMissingForInvoice(documentType, '30-12345678-9')).toBe(false);
      expect(isConfirmDisabled({ cartLength: 2, isProcessingPayment: false, documentType, customerDoc: '30-12345678-9' })).toBe(false);
    });
  });

  describe.each(['ticket', 'remito', 'presupuesto', 'nota_credito'] as DocumentType[])('%s (no exige CUIT)', documentType => {
    it('sin CUIT cargado — NO bloquea la confirmación', () => {
      expect(cuitMissingForInvoice(documentType, '')).toBe(false);
      expect(isConfirmDisabled({ cartLength: 2, isProcessingPayment: false, documentType, customerDoc: '' })).toBe(false);
    });
  });

  it('el guard de CUIT no anula los otros bloqueos (carrito vacío sigue deshabilitando)', () => {
    expect(isConfirmDisabled({ cartLength: 0, isProcessingPayment: false, documentType: 'ticket', customerDoc: '' })).toBe(true);
  });

  it('el guard de CUIT no anula los otros bloqueos (pago en proceso sigue deshabilitando)', () => {
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: true, documentType: 'ticket', customerDoc: '' })).toBe(true);
  });

  it('cambiar de factura_a (sin CUIT) a ticket libera el bloqueo sin tocar el CUIT', () => {
    const customerDoc = '';
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_a', customerDoc })).toBe(true);
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'ticket', customerDoc })).toBe(false);
  });

  it('cargar el CUIT sin cambiar de tipo libera el bloqueo', () => {
    let customerDoc = '';
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_c', customerDoc })).toBe(true);
    customerDoc = '20-98765432-1';
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_c', customerDoc })).toBe(false);
  });
});
