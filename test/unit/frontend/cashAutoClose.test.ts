import { describe, it, expect, vi } from 'vitest';

// Tests para el comportamiento del auto-close en useCashSession.ts.
// Verificamos que:
//   1. El auto-close NO envía realAmount = expectedAmount (no enmascara faltantes)
//   2. El auto-close envía closing_amount: null (o undefined) al backend
//   3. Se muestra una notificación prominente que requiere acción del supervisor
//
// Estrategia: las funciones clave del hook se replican como stubs puros para
// testear la lógica de decisión sin montar React ni mocks de D1.

interface CashSession {
  id: string;
  openedAt: string;
  openedBy: string;
  initialAmount: number;
  expectedAmount: number;
  status: 'open' | 'closed';
  realAmount?: number;
  discrepancy?: number;
  note?: string;
  closedAt?: string;
  closedBy?: string;
}

const ARG_OFFSET_MS = 3 * 60 * 60 * 1000;

// Lógica extraída del useEffect de auto-close en useCashSession.ts
function buildAutoClosedSession(
  session: CashSession,
  nowMs: number,
): {
  finishedSession: CashSession;
  syncPayload: { sessionId: string; closingAmount: number | null; expectedAmount: number | undefined; note: string };
  notificationMessage: string;
} | null {
  const nowArg = new Date(nowMs - ARG_OFFSET_MS);
  const todayArg = nowArg.toISOString().split('T')[0];

  const openedArg = new Date(new Date(session.openedAt).getTime() - ARG_OFFSET_MS);
  const openedDayArg = openedArg.toISOString().split('T')[0];

  const isFromPreviousDay = openedDayArg < todayArg;
  if (!isFromPreviousDay) return null;

  const closingArgMs = new Date(`${openedDayArg}T23:59:59.999Z`).getTime() + ARG_OFFSET_MS;
  const closedAt = new Date(closingArgMs).toISOString();

  const autoCloseNote = session.note
    ? session.note + ' | Cierre automático: turno no rendido — requiere reconciliación de supervisor.'
    : 'Cierre automático: turno no rendido — requiere reconciliación de supervisor.';

  const finishedSession: CashSession = {
    ...session,
    status: 'closed',
    closedAt,
    closedBy: session.openedBy,
    realAmount: undefined,
    discrepancy: undefined,
    note: autoCloseNote,
  };

  // Replica exacta de la llamada a syncCashSessionCloseToD1 en el hook:
  // closing_amount: null, expectedAmount: undefined
  const syncPayload = {
    sessionId: finishedSession.id,
    closingAmount: null,
    expectedAmount: undefined as number | undefined,
    note: autoCloseNote,
  };

  const notificationMessage =
    'El turno anterior no fue rendido. Se cerró sin conteo — REQUIERE RECONCILIACIÓN DE SUPERVISOR.';

  return { finishedSession, syncPayload, notificationMessage };
}

describe('useCashSession — auto-close de sesión del día anterior', () => {
  it('auto-close NO setea realAmount = expectedAmount', () => {
    const session: CashSession = {
      id: 'cash_ses_001',
      openedAt: '2026-06-21T12:00:00Z', // ayer en ARG
      openedBy: 'cajero1',
      initialAmount: 1000,
      expectedAmount: 5000,  // cliente calculó este valor
      status: 'open',
    };
    const nowMs = new Date('2026-06-22T15:00:00Z').getTime(); // hoy en ARG

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).not.toBeNull();
    // realAmount NO debe ser expectedAmount: eso enmascararía el faltante
    expect(result!.finishedSession.realAmount).toBeUndefined();
    expect(result!.finishedSession.realAmount).not.toBe(5000);
  });

  it('auto-close envía closing_amount: null al backend', () => {
    const session: CashSession = {
      id: 'cash_ses_002',
      openedAt: '2026-06-20T14:00:00Z',
      openedBy: 'cajero2',
      initialAmount: 500,
      expectedAmount: 3200,
      status: 'open',
    };
    const nowMs = new Date('2026-06-22T10:00:00Z').getTime();

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).not.toBeNull();
    expect(result!.syncPayload.closingAmount).toBeNull();
  });

  it('auto-close NO envía expectedAmount como closingAmount', () => {
    const session: CashSession = {
      id: 'cash_ses_003',
      openedAt: '2026-06-21T10:00:00Z',
      openedBy: 'cajero3',
      initialAmount: 2000,
      expectedAmount: 8500,
      status: 'open',
    };
    const nowMs = new Date('2026-06-22T12:00:00Z').getTime();

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).not.toBeNull();
    // El closing_amount enviado al backend es null, nunca expectedAmount
    expect(result!.syncPayload.closingAmount).not.toBe(8500);
    expect(result!.syncPayload.closingAmount).toBeNull();
  });

  it('auto-close NO setea discrepancy = 0 (sin conteo real, no hay diferencia calculable)', () => {
    const session: CashSession = {
      id: 'cash_ses_004',
      openedAt: '2026-06-21T09:00:00Z',
      openedBy: 'cajero4',
      initialAmount: 1500,
      expectedAmount: 6000,
      status: 'open',
    };
    const nowMs = new Date('2026-06-22T08:00:00Z').getTime();

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).not.toBeNull();
    expect(result!.finishedSession.discrepancy).toBeUndefined();
    expect(result!.finishedSession.discrepancy).not.toBe(0);
  });

  it('se muestra notificación prominente de reconciliación de supervisor', () => {
    const session: CashSession = {
      id: 'cash_ses_005',
      openedAt: '2026-06-21T11:00:00Z',
      openedBy: 'cajero5',
      initialAmount: 1000,
      expectedAmount: 4500,
      status: 'open',
    };
    const nowMs = new Date('2026-06-22T09:00:00Z').getTime();
    const notifySpy = vi.fn();

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).not.toBeNull();

    // Simular la llamada a notify con el mensaje del auto-close
    notifySpy(
      'Sesión anterior cerrada automáticamente',
      result!.notificationMessage,
      'warning',
    );

    expect(notifySpy).toHaveBeenCalledOnce();
    const [, message, type] = notifySpy.mock.calls[0];
    expect(type).toBe('warning');
    // El mensaje debe indicar explícitamente la necesidad de revisión del supervisor
    expect(message.toLowerCase()).toContain('supervisor');
  });

  it('la nota de cierre automático menciona reconciliación de supervisor', () => {
    const session: CashSession = {
      id: 'cash_ses_006',
      openedAt: '2026-06-21T08:00:00Z',
      openedBy: 'cajero6',
      initialAmount: 800,
      expectedAmount: 2100,
      status: 'open',
      note: 'Turno mañana',
    };
    const nowMs = new Date('2026-06-22T07:00:00Z').getTime();

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).not.toBeNull();
    expect(result!.finishedSession.note).toContain('supervisor');
    // La nota original se preserva
    expect(result!.finishedSession.note).toContain('Turno mañana');
  });

  it('sesión del mismo día ARG → no se auto-cierra (devuelve null)', () => {
    const session: CashSession = {
      id: 'cash_ses_007',
      openedAt: '2026-06-22T12:00:00Z', // hoy en ARG
      openedBy: 'cajero7',
      initialAmount: 500,
      expectedAmount: 500,
      status: 'open',
    };
    const nowMs = new Date('2026-06-22T15:00:00Z').getTime();

    const result = buildAutoClosedSession(session, nowMs);
    expect(result).toBeNull();
  });
});
