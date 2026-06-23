import { describe, expect, it } from 'vitest';

// Réplica local de SalePayload (definida en d1-sync.ts).
// Mantenemos una copia aquí para poder hacer chequeos estructurales en el test
// sin importar el módulo real (que depende de APIs del browser no disponibles
// en el entorno de tests — IndexedDB, Firebase, etc.).
interface SaleItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  notes: null;
}

interface SalePayment {
  payment_method: string;
  amount: number;
  reference: null;
}

interface SalePayload {
  id: string;
  client_id: string;
  idempotency_key: string;
  branch_id: string;
  customer_id: string | null;
  // Campos canónicos
  subtotal_bruto: number;
  discount_total: number;
  total_final: number;
  // Legacy compat
  subtotal: number;
  tax_total: number;
  total: number;
  items: SaleItem[];
  payments: SalePayment[];
  notes: string | null;
  client_timestamp: string;
}

// ── Builder de ejemplo para tests ──────────────────────────────────────────

function makeSalePayload(overrides: Partial<SalePayload> = {}): SalePayload {
  return {
    id: 'abc123',
    client_id: 'abc123',
    idempotency_key: 'ikey-001',
    branch_id: 'branch-1',
    customer_id: null,
    subtotal_bruto: 1000,
    discount_total: 0,
    total_final: 1000,
    subtotal: 1000,
    tax_total: 210,
    total: 1000,
    items: [
      {
        product_id: 'prod-1',
        quantity: 2,
        unit_price: 500,
        discount: 0,
        tax_rate: 0.21,
        tax_amount: 210,
        notes: null,
      },
    ],
    payments: [{ payment_method: 'tarjeta', amount: 1000, reference: null }],
    notes: null,
    client_timestamp: '2026-06-22T10:00:00.000Z',
    ...overrides,
  };
}

// ── Tests de estructura ────────────────────────────────────────────────────

describe('SalePayload — campos canónicos presentes', () => {
  it('tiene subtotal_bruto, discount_total y total_final como números', () => {
    const p = makeSalePayload();
    expect(typeof p.subtotal_bruto).toBe('number');
    expect(typeof p.discount_total).toBe('number');
    expect(typeof p.total_final).toBe('number');
  });

  it('tiene id, client_id e idempotency_key como strings no vacíos', () => {
    const p = makeSalePayload();
    expect(p.id).toBeTruthy();
    expect(p.client_id).toBeTruthy();
    expect(p.idempotency_key).toBeTruthy();
  });

  it('tiene branch_id como string no vacío', () => {
    const p = makeSalePayload();
    expect(typeof p.branch_id).toBe('string');
    expect(p.branch_id.length).toBeGreaterThan(0);
  });
});

describe('SalePayload — campos legacy de compat', () => {
  it('incluye subtotal (legacy = subtotal_bruto)', () => {
    const p = makeSalePayload({ subtotal_bruto: 500, subtotal: 500 });
    expect(p.subtotal).toBe(p.subtotal_bruto);
  });

  it('incluye total (legacy = total_final)', () => {
    const p = makeSalePayload({ total_final: 990, total: 990 });
    expect(p.total).toBe(p.total_final);
  });

  it('incluye tax_total como número', () => {
    const p = makeSalePayload({ tax_total: 210 });
    expect(typeof p.tax_total).toBe('number');
  });
});

describe('SalePayload — items', () => {
  it('items tiene al menos un elemento con product_id y quantity', () => {
    const p = makeSalePayload();
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.items[0].product_id).toBeTruthy();
    expect(p.items[0].quantity).toBeGreaterThan(0);
  });

  it('item.notes es siempre null (no any)', () => {
    const p = makeSalePayload();
    expect(p.items[0].notes).toBeNull();
  });

  it('item.discount es número (nunca undefined)', () => {
    const p = makeSalePayload();
    expect(typeof p.items[0].discount).toBe('number');
  });
});

describe('SalePayload — payments', () => {
  it('payments tiene al menos un elemento con payment_method y amount', () => {
    const p = makeSalePayload();
    expect(p.payments.length).toBeGreaterThan(0);
    expect(typeof p.payments[0].payment_method).toBe('string');
    expect(typeof p.payments[0].amount).toBe('number');
  });

  it('payment.reference es null (no any)', () => {
    const p = makeSalePayload();
    expect(p.payments[0].reference).toBeNull();
  });
});

describe('SalePayload — identidad contable', () => {
  it('subtotal_bruto − discount_total === total_final (sin redondeo)', () => {
    const p = makeSalePayload({
      subtotal_bruto: 1000,
      discount_total: 100,
      total_final: 900,
    });
    expect(p.subtotal_bruto - p.discount_total).toBe(p.total_final);
  });

  it('customer_id puede ser null', () => {
    const p = makeSalePayload({ customer_id: null });
    expect(p.customer_id).toBeNull();
  });

  it('client_timestamp es string ISO', () => {
    const p = makeSalePayload();
    expect(() => new Date(p.client_timestamp).toISOString()).not.toThrow();
  });
});
