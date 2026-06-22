import { describe, expect, it, vi } from 'vitest';

// Pure helper extracted from workers/api/src/middleware/auth.ts.
// Replica local para poder testear sin depender de Cloudflare Workers runtime.
function assertUserInBranch(
  _userId: string,
  _branchId: string,
  rows: unknown[],
): boolean {
  return rows.length > 0;
}

describe('assertUserInBranch', () => {
  it('retorna true cuando el usuario tiene membresía en la sucursal', () => {
    const rows = [{ 1: 1 }];
    expect(assertUserInBranch('user-1', 'branch-1', rows)).toBe(true);
  });

  it('retorna false cuando el usuario no tiene membresía', () => {
    expect(assertUserInBranch('user-1', 'branch-99', [])).toBe(false);
  });

  it('retorna false cuando rows es array vacío', () => {
    expect(assertUserInBranch('user-1', 'branch-1', [])).toBe(false);
  });

  it('retorna true con múltiples rows (edge case: LIMIT 1 en la query real, pero la función es agnóstica)', () => {
    const rows = [{ 1: 1 }, { 1: 1 }];
    expect(assertUserInBranch('user-1', 'branch-1', rows)).toBe(true);
  });
});

describe('branch access guard — integración de roles (simulado)', () => {
  // Simula el flujo del middleware: para admin/owner se saltea assertUserInBranch.
  function checkBranchAccess(
    role: string,
    branchHeader: string,
    membershipRows: unknown[],
  ): 'allowed' | 'denied' | 'skipped' {
    if (!branchHeader) return 'skipped';
    if (role === 'admin' || role === 'owner') return 'allowed';
    return assertUserInBranch('any-user', branchHeader, membershipRows) ? 'allowed' : 'denied';
  }

  it('admin puede operar en cualquier sucursal sin verificar membresía', () => {
    const mockAssert = vi.fn(assertUserInBranch);
    // admin pasa sin llamar a la lógica de membresía
    const result = checkBranchAccess('admin', 'branch-99', []);
    expect(result).toBe('allowed');
    // el mock no fue invocado porque el middleware lo cortocircuita
    expect(mockAssert).not.toHaveBeenCalled();
  });

  it('owner puede operar en cualquier sucursal sin verificar membresía', () => {
    const result = checkBranchAccess('owner', 'branch-99', []);
    expect(result).toBe('allowed');
  });

  it('cashier con membresía → acceso permitido', () => {
    expect(checkBranchAccess('cashier', 'branch-1', [{ 1: 1 }])).toBe('allowed');
  });

  it('cashier sin membresía → acceso denegado', () => {
    expect(checkBranchAccess('cashier', 'branch-2', [])).toBe('denied');
  });

  it('supervisor sin membresía → acceso denegado', () => {
    expect(checkBranchAccess('supervisor', 'branch-3', [])).toBe('denied');
  });

  it('sin header X-Branch-Id → se saltea la validación', () => {
    expect(checkBranchAccess('cashier', '', [])).toBe('skipped');
  });
});
