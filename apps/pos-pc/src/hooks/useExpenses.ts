import { useState, useEffect } from 'react';
import { INITIAL_EXPENSES } from '../initialData';
import { safeSetItem } from '../utils/safeStorage';
import { syncExpenseToD1 } from '../services/d1-sync';
import type { Expense } from '../types';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

const safeParse = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    localStorage.removeItem(key);
    return fallback;
  }
};

export function useExpenses(notify: NotifyFn) {
  const [expenses, setExpenses] = useState<Expense[]>(() =>
    safeParse<Expense[]>('pan_erp_expenses', INITIAL_EXPENSES)
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
    syncExpenseToD1(expenseInstance).catch(() => {});
    notify(
      '📉 Gasto Registrado',
      `Se registró un egreso por $${expenseInstance.amount.toFixed(2)} bajo el concepto: ${expenseInstance.concept}`,
      'info'
    );
  };

  return { expenses, setExpenses, addExpense };
}
