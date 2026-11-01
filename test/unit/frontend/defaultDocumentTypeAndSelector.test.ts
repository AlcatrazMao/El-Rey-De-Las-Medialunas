import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings } from '../../../apps/pos-pc/src/hooks/useSettings';
import { FAMILIES, VARIANTS_BY_FAMILY } from '../../../apps/pos-pc/src/components/pos/DocumentTypeSelectorModal';
import type { DocumentType } from '../../../apps/pos-pc/src/types';

describe('Document Types & Default Document Configuration (Phase 3 & 4)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('useSettings: defaultDocumentType persistence and defaults', () => {
    it('retorna "ticket" por defecto si localStorage está vacío', () => {
      const settings = getSettings();
      expect(settings.pos.defaultDocumentType).toBe('ticket');
    });

    it('retorna "ticket" si pos está definido en localStorage pero sin defaultDocumentType', () => {
      localStorage.setItem('erp_settings', JSON.stringify({
        pos: {
          defaultPaymentMethod: 'efectivo',
          defaultViewMode: 'visual',
          enterAddsToCart: true,
        },
      }));
      const settings = getSettings();
      expect(settings.pos.defaultDocumentType).toBe('ticket');
    });

    it('persiste y recupera "factura_b" como comprobante predeterminado', () => {
      localStorage.setItem('erp_settings', JSON.stringify({
        pos: {
          defaultDocumentType: 'factura_b',
        },
      }));
      const settings = getSettings();
      expect(settings.pos.defaultDocumentType).toBe('factura_b');
    });

    it('persiste y recupera "remito" como comprobante predeterminado', () => {
      localStorage.setItem('erp_settings', JSON.stringify({
        pos: {
          defaultDocumentType: 'remito',
        },
      }));
      const settings = getSettings();
      expect(settings.pos.defaultDocumentType).toBe('remito');
    });

    it('persiste y recupera "presupuesto" como comprobante predeterminado', () => {
      localStorage.setItem('erp_settings', JSON.stringify({
        pos: {
          defaultDocumentType: 'presupuesto',
        },
      }));
      const settings = getSettings();
      expect(settings.pos.defaultDocumentType).toBe('presupuesto');
    });

    it('persiste y recupera "factura_a" como comprobante predeterminado', () => {
      localStorage.setItem('erp_settings', JSON.stringify({
        pos: {
          defaultDocumentType: 'factura_a',
        },
      }));
      const settings = getSettings();
      expect(settings.pos.defaultDocumentType).toBe('factura_a');
    });
  });

  describe('DocumentTypeSelectorModal: estructura de 6 familias y variantes', () => {
    it('define exactamente 6 familias estructuradas', () => {
      expect(FAMILIES).toHaveLength(6);
      const familyIds = FAMILIES.map(f => f.id);
      expect(familyIds).toEqual(['ticket', 'factura', 'nota_credito', 'nota_debito', 'presupuesto', 'remito']);
    });

    it('las familias directas (ticket, presupuesto, remito) no tienen variantes y definen directType', () => {
      const ticket = FAMILIES.find(f => f.id === 'ticket')!;
      expect(ticket.hasVariants).toBe(false);
      expect(ticket.directType).toBe('ticket');

      const presupuesto = FAMILIES.find(f => f.id === 'presupuesto')!;
      expect(presupuesto.hasVariants).toBe(false);
      expect(presupuesto.directType).toBe('presupuesto');

      const remito = FAMILIES.find(f => f.id === 'remito')!;
      expect(remito.hasVariants).toBe(false);
      expect(remito.directType).toBe('remito');
    });

    it('las familias fiscales (factura, nota_credito, nota_debito) tienen 4 variantes cada una (A, B, C, M)', () => {
      const factura = FAMILIES.find(f => f.id === 'factura')!;
      expect(factura.hasVariants).toBe(true);
      expect(factura.variants).toEqual(['factura_a', 'factura_b', 'factura_c', 'factura_m']);

      const nc = FAMILIES.find(f => f.id === 'nota_credito')!;
      expect(nc.hasVariants).toBe(true);
      expect(nc.variants).toEqual(['nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'nota_credito_m']);

      const nd = FAMILIES.find(f => f.id === 'nota_debito')!;
      expect(nd.hasVariants).toBe(true);
      expect(nd.variants).toEqual(['nota_debito_a', 'nota_debito_b', 'nota_debito_c', 'nota_debito_m']);
    });

    it('cubre el catálogo completo de 15 tipos de comprobantes', () => {
      const directTypes = FAMILIES.filter(f => !f.hasVariants).map(f => f.directType as DocumentType);
      const variantTypes = FAMILIES.filter(f => f.hasVariants).flatMap(f => f.variants as DocumentType[]);
      const allTypes = [...directTypes, ...variantTypes];

      expect(allTypes).toHaveLength(15);
      expect(allTypes).toContain('ticket');
      expect(allTypes).toContain('factura_a');
      expect(allTypes).toContain('factura_b');
      expect(allTypes).toContain('factura_c');
      expect(allTypes).toContain('factura_m');
      expect(allTypes).toContain('nota_credito_a');
      expect(allTypes).toContain('nota_credito_b');
      expect(allTypes).toContain('nota_credito_c');
      expect(allTypes).toContain('nota_credito_m');
      expect(allTypes).toContain('nota_debito_a');
      expect(allTypes).toContain('nota_debito_b');
      expect(allTypes).toContain('nota_debito_c');
      expect(allTypes).toContain('nota_debito_m');
      expect(allTypes).toContain('presupuesto');
      expect(allTypes).toContain('remito');
    });
  });

  describe('Requerimientos fiscales: validación de CUIT en variantes A y M', () => {
    it('las variantes A y M requieren CUIT obligatorio', () => {
      const cuitRequiredTypes = [
        ...VARIANTS_BY_FAMILY.factura.filter(v => v.requiresCuit).map(v => v.type),
        ...VARIANTS_BY_FAMILY.nota_credito.filter(v => v.requiresCuit).map(v => v.type),
        ...VARIANTS_BY_FAMILY.nota_debito.filter(v => v.requiresCuit).map(v => v.type),
      ];

      expect(cuitRequiredTypes).toEqual([
        'factura_a',
        'factura_m',
        'nota_credito_a',
        'nota_credito_m',
        'nota_debito_a',
        'nota_debito_m',
      ]);
    });

    it('las variantes B y C están orientadas a consumidor final / monotributo sin exigir CUIT obligatorio', () => {
      const nonCuitTypes = [
        ...VARIANTS_BY_FAMILY.factura.filter(v => !v.requiresCuit).map(v => v.type),
        ...VARIANTS_BY_FAMILY.nota_credito.filter(v => !v.requiresCuit).map(v => v.type),
        ...VARIANTS_BY_FAMILY.nota_debito.filter(v => !v.requiresCuit).map(v => v.type),
      ];

      expect(nonCuitTypes).toEqual([
        'factura_b',
        'factura_c',
        'nota_credito_b',
        'nota_credito_c',
        'nota_debito_b',
        'nota_debito_c',
      ]);
    });
  });

  describe('Lógica de resolución de comprobante predeterminado en POS (resolveDefaultDocumentType)', () => {
    interface DocumentTypeSetting {
      document_type: DocumentType;
      enabled: boolean;
    }

    function resolveDefaultDocumentType(
      configuredType: DocumentType | undefined,
      documentSettings: DocumentTypeSetting[]
    ): DocumentType {
      const target = configuredType || 'ticket';
      if (documentSettings.length === 0) return target;
      const setting = documentSettings.find(d => d.document_type === target);
      if (setting && !setting.enabled) {
        return 'ticket';
      }
      return target;
    }

    it('usa el comprobante configurado si está habilitado en documentSettings', () => {
      const docSettings: DocumentTypeSetting[] = [
        { document_type: 'ticket', enabled: true },
        { document_type: 'factura_b', enabled: true },
        { document_type: 'remito', enabled: true },
      ];

      expect(resolveDefaultDocumentType('factura_b', docSettings)).toBe('factura_b');
      expect(resolveDefaultDocumentType('remito', docSettings)).toBe('remito');
      expect(resolveDefaultDocumentType('ticket', docSettings)).toBe('ticket');
    });

    it('hace fallback a "ticket" si el comprobante configurado fue deshabilitado en sucursal', () => {
      const docSettings: DocumentTypeSetting[] = [
        { document_type: 'ticket', enabled: true },
        { document_type: 'factura_a', enabled: false },
      ];

      expect(resolveDefaultDocumentType('factura_a', docSettings)).toBe('ticket');
    });

    it('devuelve el configurado si documentSettings está vacío (carga offline / inicial)', () => {
      expect(resolveDefaultDocumentType('factura_b', [])).toBe('factura_b');
      expect(resolveDefaultDocumentType('remito', [])).toBe('remito');
      expect(resolveDefaultDocumentType(undefined, [])).toBe('ticket');
    });
  });

  describe('Etiquetado dinámico de botones de cobro/emisión en POS', () => {
    function getCheckoutButtonAction(documentType: DocumentType): string {
      if (documentType === 'remito') return 'EMITIR REMITO';
      if (documentType === 'presupuesto') return 'EMITIR PRESUPUESTO';
      if (documentType.startsWith('nota_credito')) return 'EMITIR NOTA DE CRÉDITO';
      if (documentType.startsWith('nota_debito')) return 'EMITIR NOTA DE DÉBITO';
      if (documentType.startsWith('factura')) return 'EMITIR FACTURA';
      return 'COBRAR';
    }

    it('retorna la acción adecuada para cada tipo de comprobante', () => {
      expect(getCheckoutButtonAction('ticket')).toBe('COBRAR');
      expect(getCheckoutButtonAction('remito')).toBe('EMITIR REMITO');
      expect(getCheckoutButtonAction('presupuesto')).toBe('EMITIR PRESUPUESTO');
      expect(getCheckoutButtonAction('nota_credito_a')).toBe('EMITIR NOTA DE CRÉDITO');
      expect(getCheckoutButtonAction('nota_credito_b')).toBe('EMITIR NOTA DE CRÉDITO');
      expect(getCheckoutButtonAction('nota_debito_a')).toBe('EMITIR NOTA DE DÉBITO');
      expect(getCheckoutButtonAction('factura_a')).toBe('EMITIR FACTURA');
      expect(getCheckoutButtonAction('factura_b')).toBe('EMITIR FACTURA');
      expect(getCheckoutButtonAction('factura_c')).toBe('EMITIR FACTURA');
      expect(getCheckoutButtonAction('factura_m')).toBe('EMITIR FACTURA');
    });
  });
});
