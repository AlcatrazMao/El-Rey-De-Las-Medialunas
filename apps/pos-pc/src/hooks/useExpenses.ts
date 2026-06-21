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
    const expenseInstance: Expense = {
      ...newExp,
      id: `exp_${Date.now()}`,
      date: new Date().toISOString(),
    };
    setExpenses(prev => [expenseInstance, ...prev]);
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
