import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Tests para la validación del payload en attemptRetry (useSyncEngine.ts)
//
// La función lee un payload de JSON (Record<string, unknown>) y antes de
// hacer el cast `as unknown as SalePayload` valida que `items` sea un array.
// Si no lo es → permanent_fail sin llegar al create().
//
// Replicamos la lógica de validación como función pura. La función en el
// hook es interna (no exportada), pero extraer la validación como pura
// permite testearla sin montar IDB/Firebase/React.
// ---------------------------------------------------------------------------

// ── Réplica de la lógica de validación ───────────────────────────────────

type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Valida que el payload parseado desde JSON sea apto para ser casteado a
 * SalePayload antes de llamar a getApi().sales.create().
 *
 * Espejo exacto de la condición en attemptRetry (useSyncEngine.ts):
 *   if (typeof payloadParsed.items !== 'object' || !Array.isArray(payloadParsed.items))
 *     → permanent_fail
 */
function validateSalePayload(payloadParsed: Record<string, unknown>): ValidationResult {
  if (typeof payloadParsed.items !== 'object' || !Array.isArray(payloadParsed.items)) {
    return { valid: false, reason: 'items debe ser un array' };
  }
  return { valid: true };
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const validPayload: Record<string, unknown> = {
  id: 'sale_001',
  client_id: 'cli_001',
  idempotency_key: 'idem_001',
  branch_id: 'branch_1',
  customer_id: null,
  subtotal_bruto: 1000,
  discount_total: 0,
  total_final: 1000,
  subtotal: 1000,
  tax_total: 0,
  total: 1000,
  items: [
    {
      product_id: 'prod_001',
      quantity: 2,
      unit_price: 500,
      discount: 0,
      tax_rate: 0,
      tax_amount: 0,
      notes: null,
    },
  ],
  payments: [{ payment_method: 'cash', amount: 1000, reference: null }],
  notes: null,
  client_timestamp: '2026-06-23T12:00:00.000Z',
};

// ── Tests — items válido ──────────────────────────────────────────────────

describe('validateSalePayload — items válido', () => {
  it('payload canónico con items array → válido', () => {
    expect(validateSalePayload(validPayload)).toEqual({ valid: true });
  });

  it('items vacío ([]) → válido — array vacío es array', () => {
    const payload = { ...validPayload, items: [] };
    expect(validateSalePayload(payload)).toEqual({ valid: true });
  });

  it('items con múltiples elementos → válido', () => {
    const payload = {
      ...validPayload,
      items: [
        { product_id: 'p1', quantity: 1, unit_price: 100, discount: 0, tax_rate: 0, tax_amount: 0, notes: null },
        { product_id: 'p2', quantity: 3, unit_price: 200, discount: 0, tax_rate: 0, tax_amount: 0, notes: null },
      ],
    };
    expect(validateSalePayload(payload)).toEqual({ valid: true });
  });
});

// ── Tests — items inválido → permanent_fail ───────────────────────────────

describe('validateSalePayload — items inválido → permanent_fail', () => {
  it('items ausente (undefined) → inválido', () => {
    const payload: Record<string, unknown> = { ...validPayload };
    delete payload['items'];
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
  });

  it('items null → inválido (Array.isArray(null) === false)', () => {
    const payload = { ...validPayload, items: null };
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
  });

  it('items string → inválido', () => {
    const payload = { ...validPayload, items: '[]' };
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
  });

  it('items número → inválido', () => {
    const payload = { ...validPayload, items: 42 };
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
  });

  it('items objeto plano {} → inválido (es object pero no array)', () => {
    const payload = { ...validPayload, items: {} };
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
  });

  it('items booleano → inválido', () => {
    const payload = { ...validPayload, items: true };
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
  });
});

// ── Tests — razón del fallo ───────────────────────────────────────────────

describe('validateSalePayload — razón de rechazo', () => {
  it('el resultado inválido incluye una propiedad reason descriptiva', () => {
    const payload: Record<string, unknown> = { ...validPayload };
    delete payload['items'];
    const result = validateSalePayload(payload);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('el resultado válido NO tiene propiedad reason', () => {
    const result = validateSalePayload(validPayload);
    expect(result.valid).toBe(true);
    expect('reason' in result).toBe(false);
  });
});

// ── Tests — cobertura de Array.isArray vs typeof ──────────────────────────

describe('validateSalePayload — distinción object/array', () => {
  it('typeof null === "object" pero Array.isArray(null) === false → capturado', () => {
    // La condición en el hook es `typeof ... !== 'object' || !Array.isArray(...)`.
    // Sin el Array.isArray, null pasaría el primer check. Este test documenta
    // que la doble condición es necesaria.
    expect(Array.isArray(null)).toBe(false);
    const result = validateSalePayload({ ...validPayload, items: null });
    expect(result.valid).toBe(false);
  });

  it('un array de arrays (nested) también pasa — isArray es recursivo-agnostico', () => {
    const payload = { ...validPayload, items: [[1, 2], [3, 4]] };
    // La validación solo verifica que sea array, no su contenido.
    expect(validateSalePayload(payload)).toEqual({ valid: true });
  });
});
