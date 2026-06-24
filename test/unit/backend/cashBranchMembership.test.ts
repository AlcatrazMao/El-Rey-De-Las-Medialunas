import { describe, it, expect } from 'vitest';

// ── Lógica pura: POST /sessions/open — validación de membership de sucursal ──
// Réplica de la lógica de autorización de cash.ts sin Hono ni D1.

// Roles que pueden abrir caja (replicado de cash.ts).
const CASH_ALLOWED_ROLES = new Set(['cashier', 'supervisor', 'admin', 'owner']);

/**
 * Determina si un usuario puede abrir una sesión de caja en una sucursal.
 *
 * Replica el guard de POST /sessions/open:
 *   1. El rol debe estar en CASH_ALLOWED_ROLES (pre-condición ya validada antes
 *      de llegar a la validación de membership).
 *   2. admin y owner tienen acceso global → siempre pueden.
 *   3. Otros roles (cashier, supervisor) necesitan membership en la sucursal.
 */
function canOpenCashSession(userRole: string, hasMembership: boolean): boolean {
  // Rol no permitido → rechaza sin importar el membership.
  if (!CASH_ALLOWED_ROLES.has(userRole)) return false;

  // Admin y owner bypasean la validación de membership (acceso global).
  if (userRole === 'admin' || userRole === 'owner') return true;

  // Cashier y supervisor necesitan pertenecer a la sucursal.
  return hasMembership;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('canOpenCashSession — bypass admin/owner', () => {
  it('admin puede abrir caja sin membership (acceso global)', () => {
    expect(canOpenCashSession('admin', false)).toBe(true);
  });

  it('owner puede abrir caja sin membership (acceso global)', () => {
    expect(canOpenCashSession('owner', false)).toBe(true);
  });

  it('admin con membership también puede (resultado idéntico)', () => {
    expect(canOpenCashSession('admin', true)).toBe(true);
  });

  it('owner con membership también puede (resultado idéntico)', () => {
    expect(canOpenCashSession('owner', true)).toBe(true);
  });
});

describe('canOpenCashSession — cashier requiere membership', () => {
  it('cashier sin membership → NO puede abrir caja', () => {
    expect(canOpenCashSession('cashier', false)).toBe(false);
  });

  it('cashier con membership → puede abrir caja', () => {
    expect(canOpenCashSession('cashier', true)).toBe(true);
  });
});

describe('canOpenCashSession — supervisor requiere membership', () => {
  it('supervisor sin membership → NO puede abrir caja', () => {
    expect(canOpenCashSession('supervisor', false)).toBe(false);
  });

  it('supervisor con membership → puede abrir caja', () => {
    expect(canOpenCashSession('supervisor', true)).toBe(true);
  });
});

describe('canOpenCashSession — roles sin permiso de caja', () => {
  it('viewer sin membership → rechazado por rol', () => {
    expect(canOpenCashSession('viewer', false)).toBe(false);
  });

  it('viewer con membership → rechazado igual (el rol no tiene acceso a caja)', () => {
    expect(canOpenCashSession('viewer', true)).toBe(false);
  });

  it('production sin membership → rechazado por rol', () => {
    expect(canOpenCashSession('production', false)).toBe(false);
  });

  it('warehouse con membership → rechazado por rol', () => {
    expect(canOpenCashSession('warehouse', true)).toBe(false);
  });

  it('rol desconocido → rechazado', () => {
    expect(canOpenCashSession('hacker', true)).toBe(false);
  });

  it('rol vacío → rechazado', () => {
    expect(canOpenCashSession('', true)).toBe(false);
  });
});
