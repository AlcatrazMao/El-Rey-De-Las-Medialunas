import { describe, it, expect } from 'vitest';

/**
 * Tests para los fixes misceláneos del backend:
 *   1. canManageCustomers — guard general para PUT /customers/:id
 *   2. weightedUnitCost   — costo promedio ponderado en /purchases/orders/:id/receive
 *   3. branch guard       — GET /sales/:id cross-branch
 *   4. cache uid validation — auth.ts cache hit con firebase_uid mismatch
 */

// ── 1. canManageCustomers ─────────────────────────────────────────────────────
// Replica exacta de la función en workers/api/src/routes/customers.ts

function canManageCustomers(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner' || role === 'supervisor';
}

describe('canManageCustomers — guard general PUT /customers/:id', () => {
  it('admin puede editar clientes', () => {
    expect(canManageCustomers('admin')).toBe(true);
  });

  it('owner puede editar clientes', () => {
    expect(canManageCustomers('owner')).toBe(true);
  });

  it('supervisor puede editar clientes', () => {
    expect(canManageCustomers('supervisor')).toBe(true);
  });

  it('cashier NO puede editar clientes', () => {
    expect(canManageCustomers('cashier')).toBe(false);
  });

  it('production NO puede editar clientes', () => {
    expect(canManageCustomers('production')).toBe(false);
  });

  it('warehouse NO puede editar clientes', () => {
    expect(canManageCustomers('warehouse')).toBe(false);
  });

  it('undefined NO puede editar clientes', () => {
    expect(canManageCustomers(undefined)).toBe(false);
  });

  it('rol vacío NO puede editar clientes', () => {
    expect(canManageCustomers('')).toBe(false);
  });
});

// ── 2. Weighted unit cost ─────────────────────────────────────────────────────
// Replica la lógica de consolidación de purchases.ts /receive

interface ConsolidatedEntry {
  received_quantity: number;
  unit_cost?: number | null;
}

function consolidateReceiveItem(
  prevEntry: ConsolidatedEntry | undefined,
  incomingQty: number,
  incomingCost: number | null | undefined,
): ConsolidatedEntry {
  if (prevEntry) {
    const totalQty = prevEntry.received_quantity + incomingQty;
    const weightedCost =
      prevEntry.unit_cost != null && incomingCost != null
        ? (prevEntry.received_quantity * prevEntry.unit_cost +
            incomingQty * incomingCost) /
          totalQty
        : incomingCost != null
          ? incomingCost
          : prevEntry.unit_cost;
    return { received_quantity: totalQty, unit_cost: weightedCost };
  }
  return { received_quantity: incomingQty, unit_cost: incomingCost };
}

describe('weightedUnitCost — consolidación de items en /receive', () => {
  it('primera entrada sin previo devuelve el valor tal cual', () => {
    const result = consolidateReceiveItem(undefined, 10, 100);
    expect(result.received_quantity).toBe(10);
    expect(result.unit_cost).toBe(100);
  });

  it('dos líneas con igual costo → costo ponderado igual al original', () => {
    const first = consolidateReceiveItem(undefined, 10, 200);
    const second = consolidateReceiveItem(first, 10, 200);
    expect(second.received_quantity).toBe(20);
    expect(second.unit_cost).toBe(200);
  });

  it('ponderado correcto con cantidades y costos distintos', () => {
    // 10 unidades a $100 + 40 unidades a $200 = (1000 + 8000) / 50 = $180
    const first = consolidateReceiveItem(undefined, 10, 100);
    const second = consolidateReceiveItem(first, 40, 200);
    expect(second.received_quantity).toBe(50);
    expect(second.unit_cost).toBeCloseTo(180, 5);
  });

  it('si prev tiene cost=null y nuevo tiene cost → adopta el nuevo cost', () => {
    const first = consolidateReceiveItem(undefined, 5, null);
    const second = consolidateReceiveItem(first, 5, 300);
    expect(second.received_quantity).toBe(10);
    expect(second.unit_cost).toBe(300);
  });

  it('si prev tiene cost y nuevo tiene cost=null → adopta el prev cost', () => {
    const first = consolidateReceiveItem(undefined, 5, 150);
    const second = consolidateReceiveItem(first, 5, null);
    expect(second.received_quantity).toBe(10);
    expect(second.unit_cost).toBe(150);
  });

  it('ambos null → resultado unit_cost null', () => {
    const first = consolidateReceiveItem(undefined, 5, null);
    const second = consolidateReceiveItem(first, 5, null);
    expect(second.received_quantity).toBe(10);
    expect(second.unit_cost).toBeNull();
  });

  it('ponderado con 3 líneas distintas', () => {
    // 5@100 + 10@200 + 5@300 = (500 + 2000 + 1500) / 20 = 200
    const a = consolidateReceiveItem(undefined, 5, 100);
    const b = consolidateReceiveItem(a, 10, 200);
    const c = consolidateReceiveItem(b, 5, 300);
    expect(c.received_quantity).toBe(20);
    expect(c.unit_cost).toBeCloseTo(200, 5);
  });
});

// ── 3. Branch guard para GET /sales/:id ──────────────────────────────────────
// Replica la lógica pura del guard sin depender de Hono ni D1.

function salesBranchGuard(params: {
  saleBranchId: string | null | undefined;
  tokenBranchId: string;
  userRole: string;
}): { allowed: boolean; code?: string } {
  const { saleBranchId, tokenBranchId, userRole } = params;
  if (
    saleBranchId &&
    saleBranchId !== tokenBranchId &&
    userRole !== 'admin' &&
    userRole !== 'owner'
  ) {
    return { allowed: false, code: 'FORBIDDEN' };
  }
  return { allowed: true };
}

describe('branch guard — GET /sales/:id', () => {
  it('misma sucursal → permitido para cualquier rol', () => {
    const result = salesBranchGuard({
      saleBranchId: 'branch-1',
      tokenBranchId: 'branch-1',
      userRole: 'cashier',
    });
    expect(result.allowed).toBe(true);
  });

  it('distinta sucursal + cashier → FORBIDDEN', () => {
    const result = salesBranchGuard({
      saleBranchId: 'branch-2',
      tokenBranchId: 'branch-1',
      userRole: 'cashier',
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('distinta sucursal + supervisor → FORBIDDEN (supervisor no es admin/owner)', () => {
    const result = salesBranchGuard({
      saleBranchId: 'branch-2',
      tokenBranchId: 'branch-1',
      userRole: 'supervisor',
    });
    expect(result.allowed).toBe(false);
  });

  it('distinta sucursal + admin → permitido', () => {
    const result = salesBranchGuard({
      saleBranchId: 'branch-2',
      tokenBranchId: 'branch-1',
      userRole: 'admin',
    });
    expect(result.allowed).toBe(true);
  });

  it('distinta sucursal + owner → permitido', () => {
    const result = salesBranchGuard({
      saleBranchId: 'branch-2',
      tokenBranchId: 'branch-1',
      userRole: 'owner',
    });
    expect(result.allowed).toBe(true);
  });

  it('saleBranchId null → no se aplica el guard (venta sin sucursal)', () => {
    const result = salesBranchGuard({
      saleBranchId: null,
      tokenBranchId: 'branch-1',
      userRole: 'cashier',
    });
    expect(result.allowed).toBe(true);
  });

  it('saleBranchId undefined → no se aplica el guard', () => {
    const result = salesBranchGuard({
      saleBranchId: undefined,
      tokenBranchId: 'branch-1',
      userRole: 'cashier',
    });
    expect(result.allowed).toBe(true);
  });
});

// ── 4. Cache UID validation — auth.ts ────────────────────────────────────────
// Replica la lógica de validación de firebase_uid en el cache hit.

interface CachedUser {
  id: string;
  firebase_uid: string;
  email: string;
  role: string;
}

function validateCachedUser(
  cached: unknown,
  uid: string,
): CachedUser | null {
  if (
    cached &&
    typeof cached === 'object' &&
    typeof (cached as Partial<CachedUser>).id === 'string' &&
    typeof (cached as Partial<CachedUser>).firebase_uid === 'string' &&
    typeof (cached as Partial<CachedUser>).email === 'string' &&
    typeof (cached as Partial<CachedUser>).role === 'string'
  ) {
    const user = cached as CachedUser;
    // firebase_uid mismatch → cache inconsistente, tratar como miss
    if (user.firebase_uid !== uid) {
      return null;
    }
    return user;
  }
  return null;
}

describe('cache uid validation — auth.ts login cache hit', () => {
  const validUser: CachedUser = {
    id: 'user-1',
    firebase_uid: 'firebase-uid-abc',
    email: 'test@example.com',
    role: 'cashier',
  };

  it('uid coincide → devuelve el usuario cacheado', () => {
    const result = validateCachedUser(validUser, 'firebase-uid-abc');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-1');
  });

  it('uid no coincide → devuelve null (cache miss)', () => {
    const result = validateCachedUser(validUser, 'firebase-uid-XYZ');
    expect(result).toBeNull();
  });

  it('cached null → devuelve null', () => {
    expect(validateCachedUser(null, 'firebase-uid-abc')).toBeNull();
  });

  it('cached sin firebase_uid → devuelve null (shape inválido)', () => {
    const incomplete = { id: 'u1', email: 'e@x.com', role: 'admin' };
    expect(validateCachedUser(incomplete, 'any')).toBeNull();
  });

  it('cached con shape completo pero firebase_uid diferente → null', () => {
    const otherUser = { ...validUser, firebase_uid: 'otro-uid' };
    expect(validateCachedUser(otherUser, 'firebase-uid-abc')).toBeNull();
  });

  it('cached con shape válido y mismo uid → usuario retornado correctamente', () => {
    const result = validateCachedUser(validUser, validUser.firebase_uid);
    expect(result?.role).toBe('cashier');
    expect(result?.email).toBe('test@example.com');
  });
});
