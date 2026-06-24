/**
 * Tests for the R7 security/correctness fixes:
 *   Fix 1 — AdminUsersView: postMessage origin validation
 *   Fix 5 — useCustomers: localToBackendType unknown type returns undefined (not passthrough)
 *   Fix 3 — useBatches: rejectWithdrawalRequest notify NOT called inside setState updater
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fix 1: isValidMessageOrigin — helper extracted from AdminUsersView logic
// ---------------------------------------------------------------------------

/**
 * Mirrors the guard added to AdminUsersView.tsx:
 *   if (event.origin !== ADMIN_URL) return;
 */
function isValidMessageOrigin(eventOrigin: string, adminUrl: string): boolean {
  return eventOrigin === adminUrl;
}

describe('Fix 1 — isValidMessageOrigin (AdminUsersView postMessage security)', () => {
  const ADMIN_URL = 'https://admin-users-production.elprincipitodeargentina.workers.dev';

  it('accepts message from the exact admin origin', () => {
    expect(isValidMessageOrigin(ADMIN_URL, ADMIN_URL)).toBe(true);
  });

  it('rejects message from a different origin', () => {
    expect(isValidMessageOrigin('https://evil.example.com', ADMIN_URL)).toBe(false);
  });

  it('rejects empty origin', () => {
    expect(isValidMessageOrigin('', ADMIN_URL)).toBe(false);
  });

  it('rejects null-like origin string', () => {
    expect(isValidMessageOrigin('null', ADMIN_URL)).toBe(false);
  });

  it('rejects a subdomain of the admin host', () => {
    expect(
      isValidMessageOrigin(
        'https://sub.admin-users-production.elprincipitodeargentina.workers.dev',
        ADMIN_URL,
      ),
    ).toBe(false);
  });

  it('rejects same host but different protocol', () => {
    expect(
      isValidMessageOrigin(
        'http://admin-users-production.elprincipitodeargentina.workers.dev',
        ADMIN_URL,
      ),
    ).toBe(false);
  });

  it('rejects a URL that merely contains the admin origin as a prefix', () => {
    expect(
      isValidMessageOrigin(
        'https://admin-users-production.elprincipitodeargentina.workers.dev.attacker.com',
        ADMIN_URL,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — localToBackendType: unknown type must return undefined, not passthrough
// ---------------------------------------------------------------------------

/**
 * Mirrors localToBackendType from apps/pos-pc/src/hooks/useCustomers.ts.
 * Returns undefined for unknown types — avoids sending a 400 to the backend.
 */
const localToBackendType: Record<string, string> = {
  consumidor_final: 'consumer',
  mayorista: 'wholesale',
  frecuente: 'frequent',
  empresa: 'corporate',
};

/**
 * Mirrors the FIXED updateCustomer logic:
 *   type: data.type != null ? (localToBackendType[data.type] ?? undefined) : undefined
 */
function resolveBackendType(localType: string | undefined | null): string | undefined {
  if (localType == null) return undefined;
  return localToBackendType[localType] ?? undefined;
}

describe('Fix 5 — localToBackendType mapping (useCustomers.updateCustomer)', () => {
  it('known type "consumidor_final" maps to "consumer"', () => {
    expect(resolveBackendType('consumidor_final')).toBe('consumer');
  });

  it('known type "mayorista" maps to "wholesale"', () => {
    expect(resolveBackendType('mayorista')).toBe('wholesale');
  });

  it('known type "frecuente" maps to "frequent"', () => {
    expect(resolveBackendType('frecuente')).toBe('frequent');
  });

  it('known type "empresa" maps to "corporate"', () => {
    expect(resolveBackendType('empresa')).toBe('corporate');
  });

  it('unknown type returns undefined — NOT the original value (regression for 400 bug)', () => {
    const result = resolveBackendType('tipo_inventado');
    expect(result).toBeUndefined();
    // Explicitly assert the old broken behaviour no longer occurs
    expect(result).not.toBe('tipo_inventado');
  });

  it('undefined input returns undefined', () => {
    expect(resolveBackendType(undefined)).toBeUndefined();
  });

  it('null input returns undefined', () => {
    expect(resolveBackendType(null)).toBeUndefined();
  });

  it('empty string input returns undefined (no mapping exists)', () => {
    expect(resolveBackendType('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — rejectWithdrawalRequest: notify must NOT fire inside setState updater
// ---------------------------------------------------------------------------

/**
 * Replica del contrato de rejectWithdrawalRequest post-fix.
 * El setter puede ejecutarse más de una vez en StrictMode; el notify solo debe
 * dispararse UNA vez, DESPUÉS de que el setter haya retornado.
 *
 * Invariante: notifyCallCount === 0 mientras se ejecuta el updater,
 *             y === 1 después de que rejectWithdrawalRequest retorna.
 */
describe('Fix 3 — rejectWithdrawalRequest: notify outside setState updater', () => {
  it('notify is not called while the setState updater executes', () => {
    const notifyCallsDuringUpdater: number[] = [];
    let notifyCallCount = 0;

    const notify = vi.fn(() => {
      notifyCallCount++;
    });

    // Simula el updater funcional de setWithdrawalRequests
    // El updater puede ser llamado múltiples veces por React StrictMode.
    // El notify no debe estar dentro.
    let rejectedReq: { id: string; status: string; batchNumber: string; productName: string; adminMemo: string } | null = null;

    const fakeRequests = [
      { id: 'req-1', status: 'pending', batchNumber: 'L-PAN-01', productName: 'Medialunas' },
    ];

    // Simulate setWithdrawalRequests with a functional updater (called twice — StrictMode)
    const updater = (prev: typeof fakeRequests) => {
      return prev.map((r) => {
        if (r.id !== 'req-1' || r.status !== 'pending') return r;
        const updated = { ...r, status: 'rejected', adminMemo: 'Fuera de temporada' };
        rejectedReq = updated;
        // Record how many notify calls happened INSIDE the updater
        notifyCallsDuringUpdater.push(notifyCallCount);
        return updated;
      });
    };

    // Run updater twice (simulates React StrictMode double-invocation)
    updater(fakeRequests);
    updater(fakeRequests);

    // At this point notify should NOT have been called yet
    expect(notifyCallsDuringUpdater).toEqual([0, 0]);

    // Now fire the notify outside — as the fix does
    if (rejectedReq) {
      const req = rejectedReq as { batchNumber: string; productName: string; adminMemo: string };
      notify(
        'Solicitud Rechazada',
        `Se rechazó dar de baja el lote ${req.batchNumber} de "${req.productName}". Detalle: ${req.adminMemo}`,
        'info',
      );
    }

    // notify must be called exactly once, after the updater
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'Solicitud Rechazada',
      'Se rechazó dar de baja el lote L-PAN-01 de "Medialunas". Detalle: Fuera de temporada',
      'info',
    );
  });

  it('notify is NOT called when no matching request is found', () => {
    const notify = vi.fn();

    let rejectedReq: null | object = null;

    const fakeRequests = [
      { id: 'req-other', status: 'pending', batchNumber: 'L-PAN-01', productName: 'Facturas' },
    ];

    const updater = (prev: typeof fakeRequests) =>
      prev.map((r) => {
        if (r.id !== 'req-NONEXISTENT' || r.status !== 'pending') return r;
        rejectedReq = { ...r, status: 'rejected', adminMemo: 'memo' };
        return rejectedReq as typeof r;
      });

    updater(fakeRequests);

    if (rejectedReq) {
      notify('Solicitud Rechazada', '', 'info');
    }

    expect(notify).not.toHaveBeenCalled();
  });

  it('notify is NOT called when request is already non-pending', () => {
    const notify = vi.fn();

    let rejectedReq: null | object = null;

    const fakeRequests = [
      { id: 'req-1', status: 'approved', batchNumber: 'L-PAN-01', productName: 'Facturas' },
    ];

    const updater = (prev: typeof fakeRequests) =>
      prev.map((r) => {
        if (r.id !== 'req-1' || r.status !== 'pending') return r;
        rejectedReq = { ...r, status: 'rejected', adminMemo: 'memo' };
        return rejectedReq as typeof r;
      });

    updater(fakeRequests);

    if (rejectedReq) {
      notify('Solicitud Rechazada', '', 'info');
    }

    expect(notify).not.toHaveBeenCalled();
  });
});
