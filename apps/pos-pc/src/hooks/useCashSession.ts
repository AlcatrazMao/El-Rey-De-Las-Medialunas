import { useState, useEffect } from 'react';
import { safeSetItem, safeRemoveItem } from '../utils/safeStorage';
import { getSettings } from './useSettings';
import { syncCashSessionToD1, syncCashSessionCloseToD1 } from '../services/d1-sync';
import type { CashSession } from '../types';

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
      `Se abrió la caja con un saldo inicial de $${initialAmount.toFixed(2)} por ${activeUser.name}.`,
      'success',
    );
    syncCashSessionToD1({
      id: newSession.id,
      branch_id: getSettings().business.branchId,
      opening_amount: initialAmount,
      status: 'open',
      notes: note ?? '',
    }).catch(() => {});
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
      `Caja cerrada. Esperado: $${expected.toFixed(2)}, Real: $${realAmount.toFixed(2)}, Discrepancia: $${discrepancy.toFixed(2)}`,
      Math.abs(discrepancy) < 0.01 ? 'success' : 'warning',
    );
    syncCashSessionCloseToD1(sessionId, realAmount, expected, note).catch(() => {});
    onCashClose?.();
  };

  return {
    currentCashSession,
    setCurrentCashSession,
    cashSessionsHistory,
    setCashSessionsHistory,
    openCashSession,
    closeCashSession,
  };
}
