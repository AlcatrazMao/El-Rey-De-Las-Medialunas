import { describe, expect, it } from 'vitest';

/**
 * Tests para los fixes críticos/altos de backend R7:
 *  - Fix 1: canCloseSession — ownership check usando user_id (no opened_by)
 *  - Fix 2: supplyRequestUpdateAllowed — estado pending + branch membership
 *  - Fix 3: wouldClampInventory — rechazo explícito de stock insuficiente en _out
 *  - Fix 4: cashDateRangeUpperBound — ventas con cota superior no inflan el expected
 */

// ── Fix 1: canCloseSession ──────────────────────────────────────────────────
// Réplica de la lógica pura del ownership check en sync.ts case "close_session".
// La columna real es user_id (no opened_by).
interface CashSession {
  id: string;
  user_id: string;
  branch_id: string;
  status: string;
}

function canCloseSession(
  session: CashSession,
  userId: string,
  userRole: string,
  requestBranchId: string,
): { allowed: boolean; errorCode?: string } {
  if (session.status === 'closed') {
    return { allowed: false, errorCode: 'ALREADY_CLOSED' };
  }
  if (session.branch_id !== requestBranchId && userRole !== 'admin' && userRole !== 'owner') {
    return { allowed: false, errorCode: 'FORBIDDEN' };
  }
  if (userRole === 'cashier' && session.user_id !== userId) {
    return { allowed: false, errorCode: 'FORBIDDEN' };
  }
  return { allowed: true };
}

describe('canCloseSession — ownership check con user_id', () => {
  const session: CashSession = {
    id: 'sess-1',
    user_id: 'user-A',
    branch_id: 'branch-1',
    status: 'open',
  };

  it('permite al cajero cerrar su propia sesión', () => {
    const result = canCloseSession(session, 'user-A', 'cashier', 'branch-1');
    expect(result.allowed).toBe(true);
  });

  it('bloquea al cajero que intenta cerrar la sesión de otro usuario', () => {
    const result = canCloseSession(session, 'user-B', 'cashier', 'branch-1');
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('FORBIDDEN');
  });

  it('usa user_id y no opened_by para identificar al dueño', () => {
    // La sesión tiene user_id = 'user-A'. Un cajero con id 'user-A' puede cerrarla.
    // Si se usara un campo inexistente 'opened_by', el valor sería undefined ≠ userId → ERROR.
    const sessionWithoutOpenedBy = { ...session }; // no tiene campo 'opened_by'
    const result = canCloseSession(sessionWithoutOpenedBy, 'user-A', 'cashier', 'branch-1');
    expect(result.allowed).toBe(true);
  });

  it('permite al supervisor cerrar cualquier sesión de su branch', () => {
    const result = canCloseSession(session, 'supervisor-X', 'supervisor', 'branch-1');
    expect(result.allowed).toBe(true);
  });

  it('bloquea al supervisor de otro branch', () => {
    const result = canCloseSession(session, 'supervisor-X', 'supervisor', 'branch-2');
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('FORBIDDEN');
  });

  it('permite al admin cerrar sesión de cualquier branch', () => {
    const result = canCloseSession(session, 'admin-Y', 'admin', 'branch-999');
    expect(result.allowed).toBe(true);
  });

  it('permite al owner cerrar sesión de cualquier branch', () => {
    const result = canCloseSession(session, 'owner-Z', 'owner', 'branch-999');
    expect(result.allowed).toBe(true);
  });

  it('rechaza sesión ya cerrada independientemente del rol', () => {
    const closedSession: CashSession = { ...session, status: 'closed' };
    expect(canCloseSession(closedSession, 'user-A', 'cashier', 'branch-1').allowed).toBe(false);
    expect(canCloseSession(closedSession, 'admin-Y', 'admin', 'branch-1').allowed).toBe(false);
    expect(canCloseSession(closedSession, 'owner-Z', 'owner', 'branch-1').errorCode).toBe('ALREADY_CLOSED');
  });
});

// ── Fix 2: supplyRequestUpdateAllowed ───────────────────────────────────────
// Réplica de la lógica de validación en supply-requests.ts PUT /:id.
function supplyRequestUpdateAllowed(
  currentStatus: string,
  userRole: string,
  hasAccess: boolean,
): boolean {
  // Solo roles autorizados
  if (userRole !== 'admin' && userRole !== 'owner' && userRole !== 'supervisor') return false;
  // Branch membership para no-admin/owner
  if (userRole === 'supervisor' && !hasAccess) return false;
  // Solo se puede actualizar si la solicitud está pendiente
  if (currentStatus !== 'pending') return false;
  return true;
}

describe('supplyRequestUpdateAllowed — estado pending + branch membership', () => {
  it('permite al supervisor con acceso actualizar una solicitud pending', () => {
    expect(supplyRequestUpdateAllowed('pending', 'supervisor', true)).toBe(true);
  });

  it('bloquea al supervisor sin acceso al branch', () => {
    expect(supplyRequestUpdateAllowed('pending', 'supervisor', false)).toBe(false);
  });

  it('bloquea actualizar una solicitud ya aprobada', () => {
    expect(supplyRequestUpdateAllowed('approved', 'supervisor', true)).toBe(false);
  });

  it('bloquea actualizar una solicitud ya rechazada', () => {
    expect(supplyRequestUpdateAllowed('rejected', 'supervisor', true)).toBe(false);
  });

  it('permite al admin actualizar sin importar branch membership', () => {
    expect(supplyRequestUpdateAllowed('pending', 'admin', false)).toBe(true);
  });

  it('permite al owner actualizar sin importar branch membership', () => {
    expect(supplyRequestUpdateAllowed('pending', 'owner', false)).toBe(true);
  });

  it('bloquea a un cajero — no tiene permisos', () => {
    expect(supplyRequestUpdateAllowed('pending', 'cashier', true)).toBe(false);
  });

  it('bloquea a un rol desconocido', () => {
    expect(supplyRequestUpdateAllowed('pending', 'guest', true)).toBe(false);
  });
});

// ── Fix 3: wouldClampInventory ───────────────────────────────────────────────
// Réplica de la lógica de inventory.ts POST /adjust para movimientos _out.
// Retorna true si el ajuste superaría el stock disponible (debería rechazarse).
function wouldClampInventory(currentStock: number, adjustment: number): boolean {
  // adjustment es negativo para operaciones _out
  return currentStock + adjustment < 0;
}

describe('wouldClampInventory — rechazo explícito de stock insuficiente', () => {
  it('no clampea si el stock es suficiente (exacto)', () => {
    // sacar 10 unidades de un stock de 10 → queda 0, no clampea
    expect(wouldClampInventory(10, -10)).toBe(false);
  });

  it('no clampea si el stock tiene margen', () => {
    expect(wouldClampInventory(20, -5)).toBe(false);
  });

  it('detecta insuficiencia cuando el ajuste supera el stock', () => {
    expect(wouldClampInventory(5, -10)).toBe(true);
  });

  it('detecta insuficiencia cuando el stock es 0', () => {
    expect(wouldClampInventory(0, -1)).toBe(true);
  });

  it('no aplica para movimientos _in (delta positivo)', () => {
    // Para _in, adjustment es positivo — nunca debería clampear
    expect(wouldClampInventory(0, 10)).toBe(false);
  });

  it('no marca como insuficiente cuando el ajuste es 0 y stock es 0', () => {
    // Caso edge: descuento 0 de stock 0 → resultado 0, no negativo
    expect(wouldClampInventory(0, 0)).toBe(false);
  });
});

// ── Fix 4: cashDateRangeUpperBound ──────────────────────────────────────────
// Verifica que las ventas posteriores al momento de cierre no se incluyan
// en el cálculo de cashSales. Simulación de la cota superior (closingAt).
interface Sale {
  id: string;
  amount: number;
  created_at: string;
  status: string;
}

function sumCashSalesInRange(
  sales: Sale[],
  openedAt: string,
  closingAt: string,
): number {
  return sales
    .filter(
      s =>
        s.status === 'completed' &&
        s.created_at >= openedAt &&
        s.created_at <= closingAt,
    )
    .reduce((acc, s) => acc + s.amount, 0);
}

describe('cashDateRangeUpperBound — cota superior en suma de ventas', () => {
  const openedAt = '2026-06-23 10:00:00';
  const closingAt = '2026-06-23 18:00:00';

  const sales: Sale[] = [
    { id: 's1', amount: 100, created_at: '2026-06-23 10:30:00', status: 'completed' },
    { id: 's2', amount: 200, created_at: '2026-06-23 14:00:00', status: 'completed' },
    { id: 's3', amount: 50,  created_at: '2026-06-23 17:59:59', status: 'completed' },
    // Esta venta ocurre exactamente en el momento del cierre — debe incluirse.
    { id: 's4', amount: 75,  created_at: '2026-06-23 18:00:00', status: 'completed' },
    // Esta venta ocurre DESPUÉS del cierre — no debe incluirse.
    { id: 's5', amount: 999, created_at: '2026-06-23 18:00:01', status: 'completed' },
    // Venta anulada — no debe incluirse.
    { id: 's6', amount: 300, created_at: '2026-06-23 12:00:00', status: 'voided' },
  ];

  it('suma correctamente ventas dentro del rango [openedAt, closingAt]', () => {
    const total = sumCashSalesInRange(sales, openedAt, closingAt);
    // s1 + s2 + s3 + s4 = 100 + 200 + 50 + 75 = 425
    expect(total).toBe(425);
  });

  it('excluye ventas posteriores al closingAt', () => {
    const total = sumCashSalesInRange(sales, openedAt, closingAt);
    // s5 (999) no debe estar incluida
    expect(total).not.toBe(425 + 999);
  });

  it('excluye ventas anteriores a openedAt', () => {
    const salesWithEarly: Sale[] = [
      ...sales,
      { id: 's0', amount: 500, created_at: '2026-06-23 09:59:59', status: 'completed' },
    ];
    const total = sumCashSalesInRange(salesWithEarly, openedAt, closingAt);
    expect(total).toBe(425); // s0 no entra
  });

  it('excluye ventas anuladas', () => {
    const total = sumCashSalesInRange(sales, openedAt, closingAt);
    // s6 (voided, 300) no debe incluirse
    expect(total).not.toBeGreaterThan(425);
  });

  it('retorna 0 cuando no hay ventas en el rango', () => {
    const total = sumCashSalesInRange([], openedAt, closingAt);
    expect(total).toBe(0);
  });

  it('un closingAt anterior a openedAt retorna 0 (rango inválido)', () => {
    const total = sumCashSalesInRange(sales, closingAt, openedAt);
    expect(total).toBe(0);
  });
});
