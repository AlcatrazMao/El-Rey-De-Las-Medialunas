import { useState, useEffect } from 'react';

import { syncCashSessionToD1, syncCashSessionCloseToD1, fetchCashSessionsFromD1 } from '../services/d1-sync';
import type { CashSession } from '../types';
import { formatCurrency } from '../utils/format';
import { safeSetItem, safeRemoveItem } from '../utils/safeStorage';

import { getSettings } from './useSettings';

/**
 * Valida el shape de un objeto crudo leído de localStorage antes de usarlo
 * como CashSession. Protege contra XSS / extensiones del browser que puedan
 * inyectar valores arbitrarios (p.ej. initialAmount: -1e10).
 *
 * Retorna la sesión tipada si el shape es válido, o null si falla cualquier
 * check — en ese caso el caller debe descartar el valor y tratar la sesión
 * como inexistente.
 */
export function validateCashSessionShape(raw: unknown): CashSession | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // id: string no vacío
  if (typeof obj.id !== 'string' || obj.id.trim() === '') return null;
  // initialAmount: número finito >= 0
  if (typeof obj.initialAmount !== 'number') return null;
  if (!Number.isFinite(obj.initialAmount)) return null;
  if (obj.initialAmount < 0) return null;
  // openedAt: string (ISO date) — validación básica de tipo
  if (typeof obj.openedAt !== 'string' || obj.openedAt.trim() === '') return null;
  // status: debe ser 'open' — solo sesiones activas son válidas para restaurar
  if (typeof obj.status !== 'string' || obj.status !== 'open') return null;
  // openedBy: string no vacío — debe identificar quién abrió la sesión
  if (typeof obj.openedBy !== 'string' || obj.openedBy.length === 0) return null;
  return raw as CashSession;
}

type NotifyFn = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
) => void;

interface UseCashSessionParams {
  notify: NotifyFn;
  getActiveUser: () => { name: string };
  onCashClose?: () => void;
}

export function useCashSession({ notify, getActiveUser, onCashClose }: UseCashSessionParams) {
  const [currentCashSession, setCurrentCashSession] = useState<CashSession | null>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_current_cash_session');
      if (!saved) return null;
      const parsed: unknown = JSON.parse(saved);
      const validated = validateCashSessionShape(parsed);
      if (!validated) {
        // Shape inválido: descartar para no propagar datos corruptos/maliciosos.
        localStorage.removeItem('pan_erp_current_cash_session');
      }
      return validated;
    } catch {
      localStorage.removeItem('pan_erp_current_cash_session');
      return null;
    }
  });

  const [cashSessionsHistory, setCashSessionsHistory] = useState<CashSession[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_cash_sessions_history');
      return saved ? (JSON.parse(saved) as CashSession[]) : [];
    } catch {
      localStorage.removeItem('pan_erp_cash_sessions_history');
      return [];
    }
  });

  const [hasMoreSessions, setHasMoreSessions] = useState(true);

  useEffect(() => {
    const session = currentCashSession;
    if (session !== null) {
      // Comparamos fechas en timezone Argentina (UTC-3) para alinearnos con el
      // backend (cash.ts hace DATE(opened_at, '-3 hours')). Si comparáramos con
      // new Date() y el navegador estuviese en otra TZ (viaje, reloj mal seteado,
      // VPN), el auto-cierre se dispararía en momentos incorrectos respecto al
      // día contable ARG.
      const ARG_OFFSET_MS = 3 * 60 * 60 * 1000;
      const nowArg = new Date(Date.now() - ARG_OFFSET_MS);
      const todayArg = nowArg.toISOString().split('T')[0]; // 'YYYY-MM-DD'

      const openedArg = new Date(new Date(session.openedAt).getTime() - ARG_OFFSET_MS);
      const openedDayArg = openedArg.toISOString().split('T')[0];

      const isFromPreviousDay = openedDayArg < todayArg;
      if (isFromPreviousDay) {
        // Cerramos a las 23:59:59.999 hora ARG del día de apertura. Construimos
        // el ISO desde la fecha ARG y le sumamos el offset para volver a UTC.
        const closingArgMs = new Date(`${openedDayArg}T23:59:59.999Z`).getTime() + ARG_OFFSET_MS;
        const closedAt = new Date(closingArgMs).toISOString();
        const autoCloseNote = session.note
          ? session.note + ' | Cierre automático: turno no rendido — requiere reconciliación de supervisor.'
          : 'Cierre automático: turno no rendido — requiere reconciliación de supervisor.';
        // NO seteamos realAmount ni discrepancy: el conteo real nunca ocurrió.
        // El backend recibe closing_amount: null para marcar la sesión como
        // 'auto_closed' y preservar la discrepancia auditable.
        const finishedSession: CashSession = {
          ...session,
          status: 'closed',
          closedAt,
          closedBy: session.openedBy,
          // realAmount y discrepancy quedan undefined — sin conteo real no hay diferencia calculable
          realAmount: undefined,
          discrepancy: undefined,
          note: autoCloseNote,
        };
        setCashSessionsHistory(prev => [finishedSession, ...prev]);
        setCurrentCashSession(null);
        // Notificación prominente: el supervisor debe revisar esta sesión.
        notify(
          'Sesión anterior cerrada automáticamente',
          'El turno anterior no fue rendido. Se cerró sin conteo — REQUIERE RECONCILIACIÓN DE SUPERVISOR.',
          'warning',
        );
        // Enviamos closing_amount: null para que el backend marque status='auto_closed'
        // y NO calcule diferencia (evita mostrar discrepancy=0 falsa en reportes).
        syncCashSessionCloseToD1(finishedSession.id, null as unknown as number, undefined as unknown as number, autoCloseNote).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Carga inicial: sin cursor (trae las más recientes).
    fetchCashSessionsFromD1(30).then((d1Sessions) => {
      if (d1Sessions.length < 30) setHasMoreSessions(false);
      if (d1Sessions.length === 0) return;
      setCashSessionsHistory(prev => {
        const localIds = new Set(prev.map(s => s.id));
        const newSessions = d1Sessions.filter(s => !localIds.has(s.id));
        if (newSessions.length === 0) return prev;
        return [...prev, ...newSessions].sort(
          (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        );
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (currentCashSession) {
      safeSetItem('pan_erp_current_cash_session', JSON.stringify(currentCashSession));
    } else {
      safeRemoveItem('pan_erp_current_cash_session');
    }
  }, [currentCashSession]);

  useEffect(() => {
    safeSetItem('pan_erp_cash_sessions_history', JSON.stringify(cashSessionsHistory));
  }, [cashSessionsHistory]);

  const openCashSession = (initialAmount: number, note?: string): void => {
    if (currentCashSession) {
      notify('⚠️ Sesión activa', 'Ya hay una caja abierta. Cerrala primero.', 'warning');
      return;
    }
    const activeUser = getActiveUser();
    const newSession: CashSession = {
      id: `cash_ses_${Date.now()}`,
      openedAt: new Date().toISOString(),
      openedBy: activeUser.name,
      initialAmount,
      expectedAmount: initialAmount,
      status: 'open',
      note: note || '',
    };
    setCurrentCashSession(newSession);
    notify(
      '🏦 Apertura de Caja',
      `Se abrió la caja con un saldo inicial de ${formatCurrency(initialAmount)} por ${activeUser.name}.`,
      'success',
    );
    syncCashSessionToD1({
      id: newSession.id,
      branch_id: getSettings().business.branchId,
      opening_amount: initialAmount,
      status: 'open',
      notes: note ?? '',
    }).catch(() =>
      notify(
        '⚠️ Sync fallido',
        'La sesión se guardó localmente pero no se sincronizó con el servidor.',
        'warning',
      ),
    );
  };

  const closeCashSession = (realAmount: number, note?: string): void => {
    if (!currentCashSession) return;
    const activeUser = getActiveUser();
    const sessionId = currentCashSession.id;
    const expected = currentCashSession.expectedAmount;
    const discrepancy = realAmount - expected;
    const finishedSession: CashSession = {
      ...currentCashSession,
      closedAt: new Date().toISOString(),
      closedBy: activeUser.name,
      realAmount,
      discrepancy,
      status: 'closed',
      note: note || currentCashSession.note,
    };
    setCashSessionsHistory((prev) => [finishedSession, ...prev]);
    setCurrentCashSession(null);
    notify(
      '🏦 Cierre de Caja',
      `Caja cerrada. Esperado: ${formatCurrency(expected)}, Real: ${formatCurrency(realAmount)}, Discrepancia: ${formatCurrency(discrepancy)}`,
      Math.abs(discrepancy) < 0.01 ? 'success' : 'warning',
    );
    syncCashSessionCloseToD1(sessionId, realAmount, expected, note).catch(() =>
      notify(
        '⚠️ Sync fallido',
        'La sesión se guardó localmente pero no se sincronizó con el servidor.',
        'warning',
      ),
    );
    onCashClose?.();
  };

  // Cierra una sesión abierta que aparece en el historial (no es la sesión corriente).
  // Caso de uso: sesión de un día anterior que nunca se cerró y ahora se muestra en el historial.
  const closeHistoricalSession = (sessionId: string, realAmount: number, note?: string): void => {
    const session = cashSessionsHistory.find(s => s.id === sessionId && s.status === 'open');
    if (!session) return;
    const activeUser = getActiveUser();
    const expected = session.expectedAmount;
    const discrepancy = realAmount - expected;
    const finishedSession: CashSession = {
      ...session,
      closedAt: new Date().toISOString(),
      closedBy: activeUser.name,
      realAmount,
      discrepancy,
      status: 'closed',
      note: note || session.note,
    };
    setCashSessionsHistory(prev => prev.map(s => s.id === sessionId ? finishedSession : s));
    notify(
      '🔒 Sesión histórica cerrada',
      `Sesión anterior cerrada. Esperado: ${formatCurrency(expected)}, Real: ${formatCurrency(realAmount)}, Discrepancia: ${formatCurrency(discrepancy)}`,
      Math.abs(discrepancy) < 0.01 ? 'success' : 'warning',
    );
    syncCashSessionCloseToD1(sessionId, realAmount, expected, note).catch(() =>
      notify(
        '⚠️ Sync fallido',
        'El cierre se guardó localmente pero no se sincronizó con el servidor.',
        'warning',
      ),
    );
  };

  const loadMoreSessions = (): void => {
    // Cursor-based: usamos el id más chico (lexicográficamente) ya cargado como
    // before_id. El backend devuelve sesiones con id < before_id. Esto evita
    // que una sesión insertada en paralelo desplace nuestra ventana y nos haga
    // saltar/duplicar registros.
    const beforeId = cashSessionsHistory.length > 0
      ? cashSessionsHistory.reduce(
          (min, s) => (s.id < min ? s.id : min),
          cashSessionsHistory[0].id,
        )
      : undefined;
    fetchCashSessionsFromD1(30, beforeId).then((d1Sessions) => {
      if (d1Sessions.length < 30) setHasMoreSessions(false);
      if (d1Sessions.length === 0) return;
      setCashSessionsHistory(prev => {
        const localIds = new Set(prev.map(s => s.id));
        const newSessions = d1Sessions.filter(s => !localIds.has(s.id));
        if (newSessions.length === 0) return prev;
        return [...prev, ...newSessions].sort(
          (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        );
      });
    }).catch(() => {});
  };

  return {
    currentCashSession,
    setCurrentCashSession,
    cashSessionsHistory,
    setCashSessionsHistory,
    openCashSession,
    closeCashSession,
    closeHistoricalSession,
    loadMoreSessions,
    hasMoreSessions,
  };
}
