import { describe, it, expect } from 'vitest';

/**
 * Test B (SDD "Document Types / Comprobantes", Fase 4) — selector condicional
 * de tipo de comprobante en POSView.tsx.
 *
 * El repo no tiene React Testing Library instalado (ver package.json de
 * apps/pos-pc y el resto de test/unit/frontend) — el patrón establecido acá es
 * replicar la lógica de derivación como función pura y testearla directo (ver
 * posViewMountGuard.test.ts, customerTypeMapping.test.ts). POSView.tsx
 * (apps/pos-pc/src/components/POSView.tsx, líneas 92-99) deriva:
 *
 *   const enabledDocumentTypes = documentSettings.filter(d => d.enabled).map(d => d.document_type);
 *   const availableDocumentTypes = enabledDocumentTypes.length > 0 ? enabledDocumentTypes : ['ticket'];
 *   const showDocumentTypeSelector = availableDocumentTypes.length > 1;
 *
 * Replicamos exactamente esa derivación (misma fuente: el array que devuelve
 * useDocumentSettings().data) para probar el comportamiento de auto-selección
 * silenciosa (selector oculto con 1 tipo) vs selector visible (2+ tipos).
 */
type DocumentType = 'ticket' | 'factura_a' | 'factura_b' | 'factura_c' | 'nota_credito' | 'remito' | 'presupuesto';

interface DocumentTypeSetting {
  document_type: DocumentType;
  enabled: boolean;
}

function deriveDocumentTypeSelectorState(documentSettings: DocumentTypeSetting[]) {
  const enabledDocumentTypes = documentSettings.filter(d => d.enabled).map(d => d.document_type);
  const availableDocumentTypes: DocumentType[] = enabledDocumentTypes.length > 0 ? enabledDocumentTypes : ['ticket'];
  const showDocumentTypeSelector = availableDocumentTypes.length > 1;
  return { availableDocumentTypes, showDocumentTypeSelector };
}

describe('POSView: selector de tipo de comprobante (useDocumentSettings)', () => {
  it('con 1 solo tipo habilitado (ticket) — selector OCULTO, auto-selección silenciosa', () => {
    const documentSettings: DocumentTypeSetting[] = [
      { document_type: 'ticket', enabled: true },
      { document_type: 'factura_a', enabled: false },
      { document_type: 'factura_b', enabled: false },
      { document_type: 'factura_c', enabled: false },
      { document_type: 'nota_credito', enabled: false },
      { document_type: 'remito', enabled: false },
      { document_type: 'presupuesto', enabled: false },
    ];

    const { availableDocumentTypes, showDocumentTypeSelector } = deriveDocumentTypeSelectorState(documentSettings);

    expect(availableDocumentTypes).toEqual(['ticket']);
    expect(showDocumentTypeSelector).toBe(false);
  });

  it('con 1 solo tipo habilitado que NO es ticket (ej. solo factura_b) — selector también OCULTO', () => {
    const documentSettings: DocumentTypeSetting[] = [
      { document_type: 'ticket', enabled: false },
      { document_type: 'factura_b', enabled: true },
    ];

    const { availableDocumentTypes, showDocumentTypeSelector } = deriveDocumentTypeSelectorState(documentSettings);

    expect(availableDocumentTypes).toEqual(['factura_b']);
    expect(showDocumentTypeSelector).toBe(false);
  });

  it('con 2+ tipos habilitados — selector VISIBLE y permite elegir entre ambos', () => {
    const documentSettings: DocumentTypeSetting[] = [
      { document_type: 'ticket', enabled: true },
      { document_type: 'factura_a', enabled: true },
      { document_type: 'factura_b', enabled: false },
    ];

    const { availableDocumentTypes, showDocumentTypeSelector } = deriveDocumentTypeSelectorState(documentSettings);

    expect(availableDocumentTypes).toEqual(['ticket', 'factura_a']);
    expect(showDocumentTypeSelector).toBe(true);
  });

  it('con los 7 tipos habilitados — selector VISIBLE con las 7 opciones', () => {
    const documentSettings: DocumentTypeSetting[] = [
      { document_type: 'ticket', enabled: true },
      { document_type: 'factura_a', enabled: true },
      { document_type: 'factura_b', enabled: true },
      { document_type: 'factura_c', enabled: true },
      { document_type: 'nota_credito', enabled: true },
      { document_type: 'remito', enabled: true },
      { document_type: 'presupuesto', enabled: true },
    ];

    const { availableDocumentTypes, showDocumentTypeSelector } = deriveDocumentTypeSelectorState(documentSettings);

    expect(availableDocumentTypes).toHaveLength(7);
    expect(showDocumentTypeSelector).toBe(true);
  });

  it('con documentSettings vacío (fetch sin resolver / sin red) — fallback a solo ticket, selector OCULTO', () => {
    // DT-13: si el fetch todavía no resolvió o falló, documentSettings=[] y
    // tratamos como "solo ticket habilitado" para NUNCA bloquear la venta.
    const { availableDocumentTypes, showDocumentTypeSelector } = deriveDocumentTypeSelectorState([]);

    expect(availableDocumentTypes).toEqual(['ticket']);
    expect(showDocumentTypeSelector).toBe(false);
  });

  it('con 0 tipos enabled=true (todos deshabilitados) — mismo fallback a ticket', () => {
    const documentSettings: DocumentTypeSetting[] = [
      { document_type: 'ticket', enabled: false },
      { document_type: 'factura_a', enabled: false },
    ];

    const { availableDocumentTypes, showDocumentTypeSelector } = deriveDocumentTypeSelectorState(documentSettings);

    expect(availableDocumentTypes).toEqual(['ticket']);
    expect(showDocumentTypeSelector).toBe(false);
  });
});
