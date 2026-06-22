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
    // UX: avisamos "en curso" antes de pegarle a la red, y resolvemos a un
    // success / warning único según el resultado del sync. Antes mostrábamos
    // "registrado" optimistamente y, si el sync fallaba, llegaba además un
    // warning — el cajero veía dos notifs contradictorias.
    notify(
      '⏳ Guardando gasto…',
      `Procesando egreso por ${formatCurrency(expenseInstance.amount)} (${expenseInstance.concept})`,
      'info'
    );
    syncExpenseToD1(expenseInstance)
      .then(() =>
        notify(
          '📉 Gasto Registrado',
          `Se registró un egreso por ${formatCurrency(expenseInstance.amount)} bajo el concepto: ${expenseInstance.concept}`,
          'success'
        )
      )
      .catch(() =>
        notify(
          '💾 Gasto guardado localmente',
          'No se pudo sincronizar con el servidor. Se reintentará automáticamente cuando vuelva la conexión.',
          'warning'
        )
      );
  };

  return { expenses, setExpenses, addExpense };
}
