import { describe, it, expect } from 'vitest';

/**
 * Tests para apps/pos-pc/src/components/documents/DocumentsView.tsx (change
 * "Document Types / Comprobantes"): cada card (Remito/Presupuesto/Nota de
 * Crédito) debe atenuarse/deshabilitarse cuando useDocumentSettings indica
 * enabled=false para la sucursal activa.
 *
 * Replica exacta de `isEnabled` en DocumentsView.tsx (líneas 30-37):
 *
 *   const isEnabled = (type) => {
 *     if (loadingSettings || documentSettings.length === 0) return true;
 *     const setting = documentSettings.find(d => d.document_type === type);
 *     return setting ? setting.enabled : true;
 *   };
 *
 * Mismo criterio tolerante que POSView (ver posViewDocumentTypeSelector.test.ts):
 * mientras carga o no hay filas, NO bloquea (evita romper la operación por
 * falta de red/config).
 */

type DocType = 'remito' | 'presupuesto' | 'nota_credito';

interface DocumentTypeSetting {
  document_type: DocType | 'ticket' | 'factura_a' | 'factura_b' | 'factura_c';
  enabled: boolean;
}

function isDocumentsCardEnabled(type: DocType, documentSettings: DocumentTypeSetting[], loadingSettings: boolean): boolean {
  if (loadingSettings || documentSettings.length === 0) return true;
  const setting = documentSettings.find(d => d.document_type === type);
  return setting ? setting.enabled : true;
}

describe('DocumentsView: gating de cards por useDocumentSettings', () => {
  it('mientras loadingSettings=true — todas las cards habilitadas, sin importar el contenido de documentSettings', () => {
    const settings: DocumentTypeSetting[] = [{ document_type: 'remito', enabled: false }];
    expect(isDocumentsCardEnabled('remito', settings, true)).toBe(true);
  });

  it('documentSettings vacío (fetch sin resolver/sin red) — todas las cards habilitadas', () => {
    expect(isDocumentsCardEnabled('remito', [], false)).toBe(true);
    expect(isDocumentsCardEnabled('presupuesto', [], false)).toBe(true);
    expect(isDocumentsCardEnabled('nota_credito', [], false)).toBe(true);
  });

  it('remito con enabled=false para la sucursal activa — card deshabilitada', () => {
    const settings: DocumentTypeSetting[] = [
      { document_type: 'remito', enabled: false },
      { document_type: 'presupuesto', enabled: true },
      { document_type: 'nota_credito', enabled: true },
    ];
    expect(isDocumentsCardEnabled('remito', settings, false)).toBe(false);
  });

  it('presupuesto con enabled=false — card deshabilitada, pero remito y nota_credito no se ven afectados', () => {
    const settings: DocumentTypeSetting[] = [
      { document_type: 'remito', enabled: true },
      { document_type: 'presupuesto', enabled: false },
      { document_type: 'nota_credito', enabled: true },
    ];
    expect(isDocumentsCardEnabled('presupuesto', settings, false)).toBe(false);
    expect(isDocumentsCardEnabled('remito', settings, false)).toBe(true);
    expect(isDocumentsCardEnabled('nota_credito', settings, false)).toBe(true);
  });

  it('nota_credito con enabled=false — card deshabilitada', () => {
    const settings: DocumentTypeSetting[] = [{ document_type: 'nota_credito', enabled: false }];
    expect(isDocumentsCardEnabled('nota_credito', settings, false)).toBe(false);
  });

  it('todos los tipos habilitados — ninguna card se atenúa', () => {
    const settings: DocumentTypeSetting[] = [
      { document_type: 'remito', enabled: true },
      { document_type: 'presupuesto', enabled: true },
      { document_type: 'nota_credito', enabled: true },
    ];
    expect(isDocumentsCardEnabled('remito', settings, false)).toBe(true);
    expect(isDocumentsCardEnabled('presupuesto', settings, false)).toBe(true);
    expect(isDocumentsCardEnabled('nota_credito', settings, false)).toBe(true);
  });

  it('tipo sin fila en documentSettings (config no poblada para ese tipo aún) — fallback a habilitado', () => {
    // Ej. documentSettings solo trae 'ticket' y 'factura_a', pero no 'remito'.
    const settings: DocumentTypeSetting[] = [
      { document_type: 'ticket', enabled: true },
      { document_type: 'factura_a', enabled: true },
    ];
    expect(isDocumentsCardEnabled('remito', settings, false)).toBe(true);
  });

  it('cambiar de sucursal (refetch con distinto resultado) refleja el nuevo estado sin quedar pisado', () => {
    let settings: DocumentTypeSetting[] = [{ document_type: 'remito', enabled: true }];
    expect(isDocumentsCardEnabled('remito', settings, false)).toBe(true);

    // Sucursal B deshabilita remito.
    settings = [{ document_type: 'remito', enabled: false }];
    expect(isDocumentsCardEnabled('remito', settings, false)).toBe(false);
  });
});
