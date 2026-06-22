import { useState, useEffect } from 'react';

import { INITIAL_EXPENSES } from '../initialData';
import { syncExpenseToD1 } from '../services/d1-sync';
import type { Expense } from '../types';
import { formatCurrency } from '../utils/format';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

export function useExpenses(notify: NotifyFn) {
  const [expenses, setExpenses] = useState<Expense[]>(() =>
    safeParseLocalStorage<Expense[]>('pan_erp_expenses', INITIAL_EXPENSES)
  );

  useEffect(() => {
    safeSetItem('pan_erp_expenses', JSON.stringify(expenses));
  }, [expenses]);

  const addExpense = (newExp: Omit<Expense, 'id' | 'date'>) => {
    // UUID hex sin guiones — consistente con el resto del proyecto y compatible
    // con el formato que valida el backend (Date.now() colisiona si el cajero
    // dispara dos altas en el mismo ms, p.ej. doble-click).
    const expenseInstance: Expense = {
      ...newExp,
      id: crypto.randomUUID().replace(/-/g, ''),
      date: new Date().toISOString(),
    };
    setExpenses(prev => {
      // Guard defensivo: si por algún motivo el UUID ya existía, no duplicamos.
      if (prev.some(e => e.id === expenseInstance.id)) return prev;
      return [expenseInstance, ...prev];
    });
    syncExpenseToD1(expenseInstance).catch(() =>
      notify(
        '⚠️ Sync fallido',
        'El gasto se guardó localmente pero no se sincronizó con el servidor.',
        'warning'
      )
    );
    notify(
      '📉 Gasto Registrado',
      `Se registró un egreso por ${formatCurrency(expenseInstance.amount)} bajo el concepto: ${expenseInstance.concept}`,
      'info'
    );
  };

  return { expenses, setExpenses, addExpense };
}
