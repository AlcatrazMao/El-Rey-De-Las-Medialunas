import { describe, it, expect } from 'vitest';

/**
 * Test C — guard de CUIT en la UI de POSView.tsx antes de confirmar una venta.
 * Corrección Fiscal AFIP:
 * - Únicamente los comprobantes clase A y M (factura_a, factura_m, nota_credito_a, etc.)
 *   exigen CUIT obligatorio del cliente.
 * - factura_b y factura_c NO deben bloquear la confirmación por falta de CUIT
 *   (permiten venta a Consumidor Final / DNI).
 */
type DocumentType =
  | 'ticket'
  | 'factura_a'
  | 'factura_b'
  | 'factura_c'
  | 'factura_m'
  | 'nota_credito'
  | 'nota_credito_a'
  | 'nota_debito_a'
  | 'remito'
  | 'presupuesto';

const CUIT_REQUIRED_DOCUMENT_TYPES: DocumentType[] = [
  'factura_a',
  'factura_m',
  'nota_credito_a',
  'nota_debito_a',
];

function cuitMissingForInvoice(documentType: DocumentType, customerDoc: string): boolean {
  const documentTypeNeedsCuit = CUIT_REQUIRED_DOCUMENT_TYPES.includes(documentType);
  return documentTypeNeedsCuit && !customerDoc.trim();
}

function isConfirmDisabled(params: { cartLength: number; isProcessingPayment: boolean; documentType: DocumentType; customerDoc: string }): boolean {
  const { cartLength, isProcessingPayment, documentType, customerDoc } = params;
  return cartLength === 0 || isProcessingPayment || cuitMissingForInvoice(documentType, customerDoc);
}

describe('POSView: guard de CUIT para comprobantes AFIP', () => {
  describe.each(['factura_a', 'factura_m', 'nota_credito_a', 'nota_debito_a'] as DocumentType[])('%s (clase A y M)', documentType => {
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

  describe.each(['factura_b', 'factura_c', 'ticket', 'remito', 'presupuesto', 'nota_credito'] as DocumentType[])('%s (no exige CUIT — Consumidor Final / DNI)', documentType => {
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

  it('factura_b y factura_c permiten cobrar sin CUIT cargado', () => {
    const customerDoc = '';
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_b', customerDoc })).toBe(false);
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_c', customerDoc })).toBe(false);
  });

  it('cargar el CUIT sin cambiar de tipo libera el bloqueo en factura_a', () => {
    let customerDoc = '';
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_a', customerDoc })).toBe(true);
    customerDoc = '20-98765432-1';
    expect(isConfirmDisabled({ cartLength: 1, isProcessingPayment: false, documentType: 'factura_a', customerDoc })).toBe(false);
  });
});
