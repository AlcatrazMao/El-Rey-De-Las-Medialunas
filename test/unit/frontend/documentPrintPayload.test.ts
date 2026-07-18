import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { printDocument } from '../../../apps/pos-pc/src/utils/exportUtils';

/**
 * Tests para apps/pos-pc/src/utils/exportUtils.ts — printDocument/
 * buildDocumentPrintPayload/buildDocumentHtml (change "Document Types /
 * Comprobantes").
 *
 * `buildDocumentPrintPayload` y `buildDocumentHtml` son funciones internas
 * (no exportadas) de exportUtils.ts. Mismo criterio que
 * resolveDisplayDocumentNumber.test.ts: en vez de exportarlas solo para
 * testear, las ejercitamos indirectamente a través de `printDocument` (sí
 * exportada), capturando el HTML que efectivamente termina escribiéndose.
 *
 * `printDocument` intenta primero el bridge local (tryPrintPayloadViaBridge);
 * como no seteamos `useBridge` en localStorage, getSettings().printer.useBridge
 * es false/undefined por default (ver useSettings.ts DEFAULT_SETTINGS) y cae
 * directo al fallback de iframe + doc.write(html) — es ese HTML el que
 * inspeccionamos.
 *
 * Puntos a cubrir (SDD Fase 4 / DT-8, DT-9, DT-7, DT-14):
 *   - remito: el HTML NO debe incluir precios/IVA/total.
 *   - presupuesto: el HTML debe incluir la fecha de validez.
 *   - nota_credito: el HTML debe incluir la referencia a la venta original.
 *   - NINGUNO de los 3 debe mostrar la leyenda fiscal "SIN VALOR FISCAL —
 *     CAE PENDIENTE" (exclusiva de factura_a/b/c) — el código la fija
 *     explícitamente a `undefined` en buildDocumentPrintPayload/buildDocumentHtml
 *     para estos 3 tipos, sin depender de document_type en runtime.
 */

const FISCAL_DISCLAIMER = 'SIN VALOR FISCAL — CAE PENDIENTE';

function captureIframeHtml(): { getHtml: () => string | null; restore: () => void } {
  let capturedHtml: string | null = null;
  const originalAppendChild = document.body.appendChild.bind(document.body);

  const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
    const el = originalAppendChild(node as unknown as Node) as unknown as HTMLIFrameElement;
    if (el && el.tagName === 'IFRAME') {
      const doc = el.contentDocument;
      if (doc) {
        const originalWrite = doc.write.bind(doc);
        vi.spyOn(doc, 'write').mockImplementation((html: string) => {
          capturedHtml = html;
          return originalWrite(html);
        });
      }
    }
    return el as unknown as Node;
  });

  return {
    getHtml: () => capturedHtml,
    restore: () => appendSpy.mockRestore(),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('printDocument: remito (DT-8 — sin precios/IVA/total)', () => {
  it('el HTML no incluye ninguna fila de precio/subtotal por item', async () => {
    const capture = captureIframeHtml();

    await printDocument('remito', {
      documentNumber: 55,
      items: [{ name: 'Medialuna de grasa', quantity: 12, price: 150 }],
      operatorName: 'Cajero Uno',
      customerName: 'Panadería Central',
    });

    const html = capture.getHtml();
    expect(html).not.toBeNull();
    // No debe aparecer el precio unitario ni el subtotal calculado (150*12=1800).
    expect(html).not.toContain('1800.00');
    expect(html).not.toContain('$150.00');
    // La columna "Subtotal" (header de items) no debe existir para remito.
    expect(html).not.toContain('>Subtotal<');
    // El bloque de TOTAL/MONTO (post-items) tampoco aparece para remito.
    expect(html).not.toContain('TOTAL:');
    expect(html).not.toContain('MONTO:');
    capture.restore();
  });

  it('nunca muestra la leyenda fiscal (exclusiva de factura_a/b/c)', async () => {
    const capture = captureIframeHtml();

    await printDocument('remito', {
      documentNumber: 55,
      items: [{ name: 'Medialuna', quantity: 1, price: 100 }],
      operatorName: 'Cajero Uno',
    });

    expect(capture.getHtml()).not.toContain(FISCAL_DISCLAIMER);
    capture.restore();
  });

  it('sí incluye el detalle de cantidad/producto (sin precio)', async () => {
    const capture = captureIframeHtml();

    await printDocument('remito', {
      documentNumber: 55,
      items: [{ name: 'Facturas surtidas', quantity: 6, price: 0 }],
      operatorName: 'Cajero Uno',
    });

    const html = capture.getHtml();
    expect(html).toContain('Facturas surtidas');
    expect(html).toContain('x6');
    capture.restore();
  });
});

describe('printDocument: presupuesto (DT-9 — incluye fecha de validez)', () => {
  it('el HTML incluye la fecha de validez (valid_until)', async () => {
    const capture = captureIframeHtml();

    await printDocument('presupuesto', {
      documentNumber: 88,
      items: [{ name: 'Torta especial', quantity: 1, price: 5000 }],
      operatorName: 'Cajero Dos',
      customerName: 'María López',
      total: 5000,
      subtotal: 5000,
      validUntil: '2026-08-15',
    });

    const html = capture.getHtml();
    expect(html).toContain('2026-08-15');
    expect(html).toContain('Válido hasta');
    capture.restore();
  });

  it('sí incluye precios/total (a diferencia del remito)', async () => {
    const capture = captureIframeHtml();

    await printDocument('presupuesto', {
      documentNumber: 88,
      items: [{ name: 'Torta especial', quantity: 2, price: 500 }],
      operatorName: 'Cajero Dos',
      total: 1000,
      subtotal: 1000,
      validUntil: '2026-08-15',
    });

    const html = capture.getHtml();
    expect(html).toContain('TOTAL:');
    expect(html).toContain('1000.00');
    capture.restore();
  });

  it('nunca muestra la leyenda fiscal', async () => {
    const capture = captureIframeHtml();

    await printDocument('presupuesto', {
      documentNumber: 88,
      items: [],
      operatorName: 'Cajero Dos',
      total: 0,
      validUntil: '2026-08-15',
    });

    expect(capture.getHtml()).not.toContain(FISCAL_DISCLAIMER);
    capture.restore();
  });
});

describe('printDocument: nota_credito (DT-7 — referencia a la venta original)', () => {
  it('el HTML incluye la referencia al comprobante original', async () => {
    const capture = captureIframeHtml();

    await printDocument('nota_credito', {
      documentNumber: 12,
      items: [],
      operatorName: 'Cajero Tres',
      total: 300,
      creditNoteReason: 'Devolución de mercadería',
      originalDocumentNumber: 1042,
    });

    const html = capture.getHtml();
    expect(html).toContain('Ref. Comprobante');
    expect(html).toContain('1042');
    capture.restore();
  });

  it('incluye el motivo de la nota de crédito', async () => {
    const capture = captureIframeHtml();

    await printDocument('nota_credito', {
      documentNumber: 12,
      items: [],
      operatorName: 'Cajero Tres',
      total: 300,
      creditNoteReason: 'Devolución parcial por producto vencido',
      originalDocumentNumber: 1042,
    });

    const html = capture.getHtml();
    expect(html).toContain('Devolución parcial por producto vencido');
    capture.restore();
  });

  it('muestra el monto bajo la etiqueta MONTO (no TOTAL)', async () => {
    const capture = captureIframeHtml();

    await printDocument('nota_credito', {
      documentNumber: 12,
      items: [],
      operatorName: 'Cajero Tres',
      total: 300,
      creditNoteReason: 'Devolución',
      originalDocumentNumber: 1042,
    });

    const html = capture.getHtml();
    expect(html).toContain('MONTO:');
    expect(html).not.toContain('>TOTAL:<');
    capture.restore();
  });

  it('nunca muestra la leyenda fiscal', async () => {
    const capture = captureIframeHtml();

    await printDocument('nota_credito', {
      documentNumber: 12,
      items: [],
      operatorName: 'Cajero Tres',
      total: 300,
      creditNoteReason: 'Devolución',
      originalDocumentNumber: 1042,
    });

    expect(capture.getHtml()).not.toContain(FISCAL_DISCLAIMER);
    capture.restore();
  });
});

describe('printDocument: la leyenda fiscal es EXCLUSIVA de factura_a/b/c (validado también fuera del flujo de venta)', () => {
  it.each(['remito', 'presupuesto', 'nota_credito'] as const)(
    '%s: fiscal_disclaimer nunca aparece en el HTML generado, sin importar el contenido de items/total',
    async style => {
      const capture = captureIframeHtml();

      await printDocument(style, {
        documentNumber: 999,
        items: [{ name: 'x', quantity: 1, price: 100 }],
        operatorName: 'Op',
        total: 100,
        subtotal: 100,
        validUntil: '2026-12-31',
        originalDocumentNumber: 1,
        creditNoteReason: 'motivo',
      });

      expect(capture.getHtml()).not.toContain(FISCAL_DISCLAIMER);
      capture.restore();
    },
  );
});
