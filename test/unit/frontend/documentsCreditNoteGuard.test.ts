import { describe, it, expect } from 'vitest';

/**
 * Tests para apps/pos-pc/src/components/documents/CreateCreditNoteModal.tsx
 * (change "Document Types / Comprobantes"): guard de venta original
 * seleccionada (DT-7, reforzado del lado UI) y filtro del buscador de ventas.
 *
 * Replica exacta de las derivaciones en CreateCreditNoteModal.tsx:
 *
 *   function saleMatchesQuery(sale: Sale, query: string): boolean {
 *     const q = query.trim().toLowerCase();
 *     if (!q) return true;
 *     return (
 *       String(sale.documentNumber ?? '').toLowerCase().includes(q) ||
 *       sale.invoiceNumber.toLowerCase().includes(q) ||
 *       (sale.customerName ?? '').toLowerCase().includes(q)
 *     );
 *   }
 *
 *   const submit = async () => {
 *     if (!selectedSale) { setErr('Buscá y seleccioná la venta original'); return; }
 *     if (!reason.trim()) { setErr('Ingresá el motivo de la nota de crédito'); return; }
 *     if (!(amount > 0)) { setErr('El monto debe ser mayor a 0'); return; }
 *     ...
 *   };
 *
 *   button disabled={submitting || !selectedSale}
 *
 * y el filtro de resultados del picker:
 *   [...sales].filter(s => s.paymentStatus !== 'voided' && saleMatchesQuery(s, query))
 *              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
 *              .slice(0, 20);
 */

interface MinimalSale {
  id: string;
  documentNumber?: string | number;
  invoiceNumber: string;
  customerName?: string;
  paymentStatus: string;
  date: string;
  total: number;
}

function saleMatchesQuery(sale: MinimalSale, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    String(sale.documentNumber ?? '').toLowerCase().includes(q) ||
    sale.invoiceNumber.toLowerCase().includes(q) ||
    (sale.customerName ?? '').toLowerCase().includes(q)
  );
}

function creditNoteSaleResults(sales: MinimalSale[], query: string): MinimalSale[] {
  return [...sales]
    .filter(s => s.paymentStatus !== 'voided' && saleMatchesQuery(s, query))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);
}

function canSubmitCreditNote(params: { selectedSale: MinimalSale | null; reason: string; amount: number }): { canSubmit: boolean; error: string | null } {
  const { selectedSale, reason, amount } = params;
  if (!selectedSale) return { canSubmit: false, error: 'Buscá y seleccioná la venta original' };
  if (!reason.trim()) return { canSubmit: false, error: 'Ingresá el motivo de la nota de crédito' };
  if (!(amount > 0)) return { canSubmit: false, error: 'El monto debe ser mayor a 0' };
  return { canSubmit: true, error: null };
}

function isSubmitButtonDisabled(params: { submitting: boolean; selectedSale: MinimalSale | null }): boolean {
  return params.submitting || !params.selectedSale;
}

function makeSale(overrides: Partial<MinimalSale> = {}): MinimalSale {
  return {
    id: 'sale_1',
    documentNumber: 1001,
    invoiceNumber: 'PENDIENTE-00000001',
    customerName: 'Juan Pérez',
    paymentStatus: 'completed',
    date: '2026-07-01T10:00:00.000Z',
    total: 500,
    ...overrides,
  };
}

describe('CreateCreditNoteModal: guard DT-7 (no permite crear sin venta original seleccionada)', () => {
  it('sin venta seleccionada — bloquea con el mensaje correcto, sin importar reason/amount', () => {
    const { canSubmit, error } = canSubmitCreditNote({ selectedSale: null, reason: 'motivo válido', amount: 100 });
    expect(canSubmit).toBe(false);
    expect(error).toBe('Buscá y seleccioná la venta original');
  });

  it('el botón de submit está disabled mientras no haya venta seleccionada', () => {
    expect(isSubmitButtonDisabled({ submitting: false, selectedSale: null })).toBe(true);
  });

  it('el botón se habilita al seleccionar una venta (y no está submitting)', () => {
    expect(isSubmitButtonDisabled({ submitting: false, selectedSale: makeSale() })).toBe(false);
  });

  it('el botón sigue disabled mientras submitting=true, aunque haya venta seleccionada', () => {
    expect(isSubmitButtonDisabled({ submitting: true, selectedSale: makeSale() })).toBe(true);
  });

  it('con venta seleccionada pero sin motivo — bloquea con mensaje de motivo', () => {
    const { canSubmit, error } = canSubmitCreditNote({ selectedSale: makeSale(), reason: '', amount: 100 });
    expect(canSubmit).toBe(false);
    expect(error).toBe('Ingresá el motivo de la nota de crédito');
  });

  it('motivo de solo espacios — sigue bloqueado (usa trim())', () => {
    const { canSubmit } = canSubmitCreditNote({ selectedSale: makeSale(), reason: '   ', amount: 100 });
    expect(canSubmit).toBe(false);
  });

  it('con venta y motivo pero amount=0 — bloquea con mensaje de monto', () => {
    const { canSubmit, error } = canSubmitCreditNote({ selectedSale: makeSale(), reason: 'devolución', amount: 0 });
    expect(canSubmit).toBe(false);
    expect(error).toBe('El monto debe ser mayor a 0');
  });

  it('con venta, motivo y amount negativo — bloquea', () => {
    const { canSubmit, error } = canSubmitCreditNote({ selectedSale: makeSale(), reason: 'devolución', amount: -50 });
    expect(canSubmit).toBe(false);
    expect(error).toBe('El monto debe ser mayor a 0');
  });

  it('todos los campos válidos — permite el submit', () => {
    const { canSubmit, error } = canSubmitCreditNote({ selectedSale: makeSale(), reason: 'devolución parcial', amount: 250 });
    expect(canSubmit).toBe(true);
    expect(error).toBeNull();
  });
});

describe('CreateCreditNoteModal: buscador de ventas (filtro + exclusión de anuladas)', () => {
  const sales: MinimalSale[] = [
    makeSale({ id: 's1', documentNumber: 1001, invoiceNumber: 'PENDIENTE-1', customerName: 'Juan Pérez', date: '2026-07-01T10:00:00.000Z' }),
    makeSale({ id: 's2', documentNumber: 1002, invoiceNumber: 'PENDIENTE-2', customerName: 'María López', date: '2026-07-02T10:00:00.000Z' }),
    makeSale({ id: 's3', documentNumber: 2001, invoiceNumber: 'PENDIENTE-3', customerName: 'Juan Gómez', date: '2026-07-03T10:00:00.000Z', paymentStatus: 'voided' }),
  ];

  it('query vacío: devuelve todas las ventas no anuladas (excluye voided)', () => {
    const results = creditNoteSaleResults(sales, '');
    expect(results.map(s => s.id)).toEqual(['s2', 's1']);
  });

  it('filtra por número de comprobante (documentNumber)', () => {
    const results = creditNoteSaleResults(sales, '1001');
    expect(results.map(s => s.id)).toEqual(['s1']);
  });

  it('filtra por invoiceNumber si documentNumber no matchea', () => {
    const results = creditNoteSaleResults(sales, 'pendiente-2');
    expect(results.map(s => s.id)).toEqual(['s2']);
  });

  it('filtra por nombre de cliente (case-insensitive)', () => {
    const results = creditNoteSaleResults(sales, 'juan');
    // "Juan Pérez" matchea; "Juan Gómez" está voided y se excluye igual.
    expect(results.map(s => s.id)).toEqual(['s1']);
  });

  it('nunca incluye ventas voided, ni siquiera si matchean la query', () => {
    const results = creditNoteSaleResults(sales, 'gómez');
    expect(results.map(s => s.id)).toEqual([]);
  });

  it('query sin matches: devuelve lista vacía', () => {
    const results = creditNoteSaleResults(sales, 'no existe ningún cliente así');
    expect(results).toEqual([]);
  });

  it('ordena por fecha descendente (más reciente primero)', () => {
    const results = creditNoteSaleResults(sales, '');
    expect(new Date(results[0].date).getTime()).toBeGreaterThan(new Date(results[1].date).getTime());
  });

  it('limita a 20 resultados', () => {
    const manySales: MinimalSale[] = Array.from({ length: 30 }, (_, i) =>
      makeSale({ id: `bulk_${i}`, documentNumber: 3000 + i, invoiceNumber: `PENDIENTE-${i}`, date: `2026-06-${(i % 28) + 1}T10:00:00.000Z` }),
    );
    const results = creditNoteSaleResults(manySales, '');
    expect(results).toHaveLength(20);
  });
});
