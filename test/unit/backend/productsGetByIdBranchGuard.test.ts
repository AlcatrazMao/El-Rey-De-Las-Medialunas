import { describe, it, expect } from 'vitest';

/**
 * Tests del branch guard de GET /:id, GET /:id/prices y GET /:id/groups.
 *
 * Replica la lógica pura extraída de workers/api/src/routes/products.ts
 * sin dependencias de Hono, D1 ni runtime de Cloudflare.
 *
 * Regla de negocio:
 *   - Producto con branch_id definido:
 *       admin / owner  → acceso siempre
 *       cualquier otro → sólo si product.branch_id === tokenBranchId
 *   - Producto global (branch_id null/undefined):
 *       cualquier rol  → acceso siempre
 */

// ── Lógica pura extraída del handler ────────────────────────────────────────

type ProductRow = { id: string; branch_id: string | null };

/**
 * Simula el branch guard de GET /:id (y sus sub-recursos /prices y /groups).
 * Retorna el HTTP status que devolvería el handler.
 */
function checkProductBranchAccess(params: {
  product: ProductRow | null;
  role: string | undefined;
  tokenBranchId: string | undefined;
}): { status: number; code: string } {
  const { product, role, tokenBranchId } = params;

  if (!product) {
    return { status: 404, code: 'NOT_FOUND' };
  }

  if (product.branch_id && role !== 'admin' && role !== 'owner') {
    if (product.branch_id !== tokenBranchId) {
      return { status: 403, code: 'FORBIDDEN' };
    }
  }

  return { status: 200, code: 'OK' };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BRANCH_A = 'branch_aaa';
const BRANCH_B = 'branch_bbb';

const productInBranchA: ProductRow = { id: 'prod_001', branch_id: BRANCH_A };
const productInBranchB: ProductRow = { id: 'prod_002', branch_id: BRANCH_B };
const globalProduct: ProductRow    = { id: 'prod_003', branch_id: null };

// ── Tests: producto con branch_id ─────────────────────────────────────────────

describe('GET /:id — branch guard (producto con branch_id)', () => {
  it('admin puede leer producto de cualquier sucursal', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'admin',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(200);
  });

  it('owner puede leer producto de cualquier sucursal', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'owner',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(200);
  });

  it('cashier con branch correcto puede leer → 200', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'cashier',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(200);
  });

  it('cashier con branch diferente → 403 FORBIDDEN', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'cashier',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('supervisor con branch diferente → 403 FORBIDDEN', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'supervisor',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('production con branch diferente → 403 FORBIDDEN', () => {
    const r = checkProductBranchAccess({
      product: productInBranchB,
      role: 'production',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('warehouse con branch diferente → 403 FORBIDDEN', () => {
    const r = checkProductBranchAccess({
      product: productInBranchB,
      role: 'warehouse',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('rol undefined con branch diferente → 403 FORBIDDEN', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: undefined,
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('rol undefined con branch correcto → 200', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: undefined,
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(200);
  });

  it('tokenBranchId undefined con producto branched → 403', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'cashier',
      tokenBranchId: undefined,
    });
    expect(r.status).toBe(403);
  });

  it('admin sin tokenBranchId puede leer igualmente → 200', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'admin',
      tokenBranchId: undefined,
    });
    expect(r.status).toBe(200);
  });
});

// ── Tests: producto global (branch_id null) ───────────────────────────────────

describe('GET /:id — branch guard (producto global sin branch_id)', () => {
  it('cashier puede leer producto global → 200', () => {
    const r = checkProductBranchAccess({
      product: globalProduct,
      role: 'cashier',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(200);
  });

  it('production puede leer producto global → 200', () => {
    const r = checkProductBranchAccess({
      product: globalProduct,
      role: 'production',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(200);
  });

  it('rol undefined puede leer producto global → 200', () => {
    const r = checkProductBranchAccess({
      product: globalProduct,
      role: undefined,
      tokenBranchId: undefined,
    });
    expect(r.status).toBe(200);
  });

  it('admin puede leer producto global → 200', () => {
    const r = checkProductBranchAccess({
      product: globalProduct,
      role: 'admin',
      tokenBranchId: undefined,
    });
    expect(r.status).toBe(200);
  });
});

// ── Tests: producto no encontrado ─────────────────────────────────────────────

describe('GET /:id — producto no encontrado', () => {
  it('producto null → 404 NOT_FOUND', () => {
    const r = checkProductBranchAccess({
      product: null,
      role: 'admin',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(404);
    expect(r.code).toBe('NOT_FOUND');
  });

  it('producto null con rol no privilegiado → 404 (no 403)', () => {
    const r = checkProductBranchAccess({
      product: null,
      role: 'cashier',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(404);
    expect(r.code).toBe('NOT_FOUND');
  });
});

// ── Tests: el guard aplica igual a /prices y /groups ─────────────────────────
// La lógica es idéntica en los tres endpoints; este bloque documenta
// que el mismo helper cubre los tres sub-recursos.

describe('GET /:id/prices y GET /:id/groups — mismo branch guard', () => {
  it('/prices: cashier de otra sucursal → 403', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'cashier',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(403);
  });

  it('/prices: owner de otra sucursal → 200', () => {
    const r = checkProductBranchAccess({
      product: productInBranchA,
      role: 'owner',
      tokenBranchId: BRANCH_B,
    });
    expect(r.status).toBe(200);
  });

  it('/groups: supervisor de otra sucursal → 403', () => {
    const r = checkProductBranchAccess({
      product: productInBranchB,
      role: 'supervisor',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(403);
  });

  it('/groups: admin de cualquier sucursal → 200', () => {
    const r = checkProductBranchAccess({
      product: productInBranchB,
      role: 'admin',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(200);
  });

  it('/groups: producto global con cualquier rol → 200', () => {
    const r = checkProductBranchAccess({
      product: globalProduct,
      role: 'warehouse',
      tokenBranchId: BRANCH_A,
    });
    expect(r.status).toBe(200);
  });
});
