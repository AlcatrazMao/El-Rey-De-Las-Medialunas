import { useState, useEffect } from 'react';
import { safeSetItem } from '../utils/safeStorage';
import { syncCustomerToD1, fetchCustomersFromD1 } from '../services/d1-sync';
import type { Customer } from '../types';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

export function useCustomers(notify: NotifyFn) {
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_customers');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (parsed === null || parsed === undefined) return [];
      return parsed as Customer[];
    } catch (e) {
      console.error('Error parsing localStorage key "pan_erp_customers":', e);
      localStorage.removeItem('pan_erp_customers');
      return [];
    }
  });

  useEffect(() => {
    safeSetItem('pan_erp_customers', JSON.stringify(customers));
  }, [customers]);

  const addCustomer = (
    data: Omit<
      Customer,
      'id' | 'created_at' | 'updated_at' | 'timeline' | 'total_purchases' | 'last_purchase_date' | 'current_debt'
    >
  ): string => {
    const now = new Date().toISOString();
    const newCustomer: Customer = {
      ...data,
      id: `cust_${Date.now()}`,
      created_at: now,
      updated_at: now,
      timeline: [
        {
          id: `tl_${Date.now()}`,
          date: now,
          type: 'status_change',
          description: 'Cliente creado',
          user: 'Sistema',
        },
      ],
      total_purchases: 0,
      last_purchase_date: '',
      current_debt: 0,
    };
    setCustomers(prev => [newCustomer, ...prev]);
    notify('👤 Cliente Creado', `${newCustomer.name} fue registrado.`, 'success');
    syncCustomerToD1(newCustomer).catch(() => {});
    return newCustomer.id;
  };

  const updateCustomer = (id: string, data: Partial<Customer>) => {
    setCustomers(prev =>
      prev.map(c => (c.id === id ? { ...c, ...data, updated_at: new Date().toISOString() } : c))
    );
  };

  const loadCustomersFromD1 = () => {
    fetchCustomersFromD1()
      .then(d1Customers => {
        if (d1Customers.length > 0) {
          setCustomers(prev => {
            const existing = new Set(prev.map(c => c.id));
            return [...prev, ...d1Customers.filter((c: { id: string }) => !existing.has(c.id))];
          });
        }
      })
      .catch(() => {});
  };

  return { customers, setCustomers, addCustomer, updateCustomer, loadCustomersFromD1 };
}
