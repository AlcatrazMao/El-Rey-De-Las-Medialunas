import { describe, it, expect, vi } from 'vitest';

import { buildThermalTicket } from '../../../apps/print-bridge/src/ticket-format';
import type { PrintSale, DocumentType } from '../../../apps/print-bridge/src/types';

/**
 * Test A (SDD "Document Types / Comprobantes", Fase 4) — leyenda fiscal +
 * remito sin precios en apps/print-bridge/src/ticket-format.ts.
 *
 * `buildThermalTicket` recibe una instancia de `ThermalPrinter` (node-thermal-printer)
 * y llama sus métodos de alto nivel (println/leftRight/etc.) — acá mockeamos esos
 * métodos con vi.fn() y reconstruimos el texto efectivamente "impreso" concatenando
 * los argumentos, para poder assertar sobre el contenido igual que si fuera un
 * string/HTML generado.
 */
function makeMockPrinter() {
  const lines: string[] = [];
  return {
    printer: {
      alignCenter: vi.fn(),
      alignLeft: vi.fn(),
      bold: vi.fn(),
      println: vi.fn((text: string) => { lines.push(text); }),
      leftRight: vi.fn((left: string, right: string) => { lines.push(`${left} ${right}`); }),
      drawLine: vi.fn(() => { lines.push('---'); }),
      cut: vi.fn(),
    },
    getOutput: () => lines.join('\n'),
  };
}

function makeSale(overrides: Partial<PrintSale> = {}): PrintSale {
  return {
    id: 'sale_1',
    invoiceNumber: 'PENDIENTE-00000001',
    date: '2026-07-10T12:00:00.000Z',
    items: [{ name: 'Medialuna', quantity: 3, price: 100 }],
    total: 363,
    tax: 63,
    operatorName: 'Cajero Uno',
    customerName: 'Consumidor Final',
    paymentMethod: 'efectivo',
    paymentStatus: 'completed',
    document_type: 'ticket',
    document_number: 1,
    ...overrides,
  };
}

const FISCAL_TYPES: DocumentType[] = ['factura_a', 'factura_b', 'factura_c'];
const NON_FISCAL_TYPES: DocumentType[] = ['ticket', 'remito', 'presupuesto', 'nota_credito'];
const DISCLAIMER = 'SIN VALOR FISCAL — CAE PENDIENTE';

describe('ticket-format: fiscal_disclaimer condicional por document_type', () => {
  describe.each(FISCAL_TYPES)('%s (tipo fiscal)', documentType => {
    it('renderiza el fiscal_disclaimer cuando está seteado', () => {
      const { printer, getOutput } = makeMockPrinter();
      const sale = makeSale({ document_type: documentType, fiscal_disclaimer: DISCLAIMER });

      buildThermalTicket(printer as any, sale, 'invoice');

      expect(getOutput()).toContain(DISCLAIMER);
    });
  });

  describe.each(NON_FISCAL_TYPES)('%s (tipo NO fiscal)', documentType => {
    it('NO renderiza el fiscal_disclaimer aunque el campo venga seteado por error', () => {
      const { printer, getOutput } = makeMockPrinter();
      // Seteamos el campo deliberadamente "por error" para probar que el código
      // valida document_type explícitamente y no confía en que venga vacío.
      const sale = makeSale({
        document_type: documentType,
        fiscal_disclaimer: DISCLAIMER,
        // nota_credito/presupuesto tienen campos propios opcionales; no afectan este check.
      });

      buildThermalTicket(printer as any, sale, documentType === 'remito' ? 'remito' : 'receipt');

      expect(getOutput()).not.toContain(DISCLAIMER);
    });

    it('tampoco lo renderiza cuando el campo no viene seteado (caso normal)', () => {
      const { printer, getOutput } = makeMockPrinter();
      const sale = makeSale({ document_type: documentType, fiscal_disclaimer: undefined });

      buildThermalTicket(printer as any, sale, documentType === 'remito' ? 'remito' : 'receipt');

      expect(getOutput()).not.toContain(DISCLAIMER);
    });
  });
});

describe('ticket-format: remito no incluye precios ni IVA', () => {
  it('no imprime ningún subtotal/precio unitario/IVA/total en el output', () => {
    const { printer, getOutput } = makeMockPrinter();
    const sale = makeSale({
      document_type: 'remito',
      items: [
        { name: 'Medialuna', quantity: 12, price: 50 },
        { name: 'Factura de manteca', quantity: 6, price: 80 },
      ],
      total: 1080,
      tax: 0,
    });

    buildThermalTicket(printer as any, sale, 'remito');
    const output = getOutput();

    // No debe aparecer ninguna etiqueta de precio/IVA/total.
    expect(output).not.toMatch(/IVA/i);
    expect(output).not.toMatch(/TOTAL/i);
    expect(output).not.toMatch(/Subtotal/i);
    // No debe aparecer ningún monto formateado como $NN.NN (precio de línea o total).
    expect(output).not.toMatch(/\$\d/);
    // Sí debe listar cantidad + nombre de producto (el remito lista qty/producto).
    expect(output).toContain('Medialuna');
    expect(output).toContain('Factura de manteca');
    expect(output).toContain('12');
    expect(output).toContain('6');
  });

  it('un ticket normal (no remito) SÍ incluye IVA/TOTAL/precios', () => {
    const { printer, getOutput } = makeMockPrinter();
    const sale = makeSale({ document_type: 'ticket' });

    buildThermalTicket(printer as any, sale, 'receipt');
    const output = getOutput();

    expect(output).toMatch(/IVA/i);
    expect(output).toMatch(/TOTAL/i);
    expect(output).toMatch(/\$\d/);
  });
});
