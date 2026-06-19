import { useState, useEffect } from 'react';

import { syncCashSessionToD1, syncCashSessionCloseToD1, fetchCashSessionsFromD1 } from '../services/d1-sync';
import type { CashSession } from '../types';
import { formatCurrency } from '../utils/format';
import { safeSetItem, safeRemoveItem } from '../utils/safeStorage';

import { getSettings } from './useSettings';

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
      return saved ? (JSON.parse(saved) as CashSession) : null;
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

  const [sessionOffset, setSessionOffset] = useState(30);
  const [hasMoreSessions, setHasMoreSessions] = useState(true);

  useEffect(() => {
    const session = currentCashSession;
    if (session !== null) {
      const openedDate = new Date(session.openedAt);
      const today = new Date();
      const isFromPreviousDay =
        openedDate.getFullYear() !== today.getFullYear() ||
        openedDate.getMonth() !== today.getMonth() ||
        openedDate.getDate() !== today.getDate();
      if (isFromPreviousDay) {
        const closedAtDate = new Date(session.openedAt);
        closedAtDate.setHours(23, 59, 59, 999);
        const closedAt = closedAtDate.toISOString();
        const finishedSession: CashSession = {
          ...session,
          status: 'closed',
          closedAt,
          closedBy: session.openedBy,
          realAmount: session.expectedAmount,
          discrepancy: 0,
          note: (session.note ? session.note + ' | Cierre automático: turno no rendido.' : 'Cierre automático: turno no rendido.'),
        };
        setCashSessionsHistory(prev => [finishedSession, ...prev]);
        setCurrentCashSession(null);
        notify('🔒 Cierre automático', 'El turno anterior no fue rendido. Se cerró automáticamente al iniciar el día.', 'warning');
        syncCashSessionCloseToD1(finishedSession.id, finishedSession.expectedAmount, finishedSession.expectedAmount, finishedSession.note).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCashSessionsFromD1(30, 0).then((d1Sessions) => {
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
    fetchCashSessionsFromD1(30, sessionOffset).then((d1Sessions) => {
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
      setSessionOffset(prev => prev + 30);
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
