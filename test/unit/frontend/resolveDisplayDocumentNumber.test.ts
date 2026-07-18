import { describe, it, expect, beforeEach } from 'vitest';

import { buildTicketHtml } from '../../../apps/pos-pc/src/utils/exportUtils';
import type { Sale } from '../../../apps/pos-pc/src/types';

/**
 * Test D (SDD "Document Types / Comprobantes", Fase 4) — placeholder de
 * número de comprobante pendiente en apps/pos-pc/src/utils/exportUtils.ts.
 *
 * `resolveDisplayDocumentNumber` es una función interna (no exportada) de
 * exportUtils.ts. En vez de exportarla solo para testear (cambiaría el código
 * de producción fuera del alcance de esta fase), la ejercitamos indirectamente
 * a través de `buildTicketHtml` (sí exportada), que la usa para armar el
 * "Nro Comp:" del HTML del comprobante — igual que hace el propio código con
 * `drawTicketPdf`/`buildThermalTicket` en print-bridge.
 *
 * Bug fix cubierto (ver comentario en exportUtils.ts línea 15-27): antes se
 * imprimía el placeholder legacy `invoiceNumber` ("PENDIENTE-XXXXXXXX") como
 * si fuera el número real de comprobante. El fix hace que, si `documentNumber`
 * todavía no llegó del backend, se muestre un texto explícitamente
 * provisorio ("(pendiente de confirmación)") en vez de un string que parezca
 * un número de comprobante válido.
 */
function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale_1',
    invoiceNumber: 'PENDIENTE-00000001',
    date: '2026-07-10T12:00:00.000Z',
    items: [{ id: 'item_1', name: 'Medialuna', quantity: 3, price: 100 } as Sale['items'][number]],
    total: 363,
    tax: 63,
    subtotal_bruto: 363,
    discount_total: 0,
    total_final: 363,
    idempotencyKey: 'idem_1',
    paymentMethod: 'efectivo',
    paymentStatus: 'completed',
    operatorRole: 'cajero',
    operatorName: 'Cajero Uno',
    documentType: 'ticket',
    ...overrides,
  } as Sale;
}

beforeEach(() => {
  localStorage.clear();
});

describe('resolveDisplayDocumentNumber (via buildTicketHtml)', () => {
  it('documentNumber undefined — muestra texto explícitamente provisorio, NO el placeholder invoiceNumber', () => {
    const sale = makeSale({ documentNumber: undefined, invoiceNumber: 'PENDIENTE-00000042' });

    const html = buildTicketHtml(sale, 'receipt');

    // No debe filtrarse el placeholder legacy que parece un número real.
    expect(html).not.toContain('PENDIENTE-00000042');
    // Debe mostrar un texto que deja explícito que es provisorio.
    expect(html).toContain('(pendiente de confirmación)');
  });

  it('documentNumber null — mismo comportamiento que undefined', () => {
    const sale = makeSale({ documentNumber: null as unknown as undefined, invoiceNumber: 'PENDIENTE-00000099' });

    const html = buildTicketHtml(sale, 'receipt');

    expect(html).not.toContain('PENDIENTE-00000099');
    expect(html).toContain('(pendiente de confirmación)');
  });

  it('documentNumber string vacío — mismo comportamiento (tratado como no-llegado)', () => {
    const sale = makeSale({ documentNumber: '', invoiceNumber: 'PENDIENTE-00000007' });

    const html = buildTicketHtml(sale, 'receipt');

    expect(html).not.toContain('PENDIENTE-00000007');
    expect(html).toContain('(pendiente de confirmación)');
  });

  it('documentNumber presente (number) — muestra el número REAL, no el placeholder', () => {
    const sale = makeSale({ documentNumber: 1042, invoiceNumber: 'PENDIENTE-00000001' });

    const html = buildTicketHtml(sale, 'receipt');

    expect(html).toContain('1042');
    expect(html).not.toContain('(pendiente de confirmación)');
    expect(html).not.toContain('PENDIENTE-00000001');
  });

  it('documentNumber presente (string, ej. con ceros a la izquierda) — se muestra tal cual, no el placeholder', () => {
    const sale = makeSale({ documentNumber: '0001042', invoiceNumber: 'PENDIENTE-00000001' });

    const html = buildTicketHtml(sale, 'receipt');

    expect(html).toContain('0001042');
    expect(html).not.toContain('(pendiente de confirmación)');
  });

  it('el texto provisorio NO tiene forma de número de comprobante válido (no son solo dígitos)', () => {
    const sale = makeSale({ documentNumber: undefined });
    const html = buildTicketHtml(sale, 'receipt');

    const match = html.match(/Nro Comp:<\/strong>\s*([^<]+)</);
    expect(match).not.toBeNull();
    const displayedValue = match![1].trim();
    // No debe ser un número puro ni parecer un correlativo tipo PENDIENTE-XXXXXXXX.
    expect(displayedValue).not.toMatch(/^\d+$/);
    expect(displayedValue).not.toMatch(/^PENDIENTE-\d+$/);
  });
});
