import { useState, useEffect } from 'react';

import { getApi } from '../services/api';
import { syncCustomerToD1, fetchCustomersFromD1 } from '../services/d1-sync';
import type { Customer } from '../types';
import { safeSetItem } from '../utils/safeStorage';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

// Inverse of backendToLocalType: maps the UI's Spanish values back to the
// backend's English identifiers so that updateCustomer sends valid values.
export const localToBackendType: Record<string, string> = {
  consumidor_final: 'consumer',
  mayorista: 'wholesale',
  frecuente: 'frequent',
  empresa: 'corporate',
};

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
    syncCustomerToD1(newCustomer).catch(() => {
      notify('⚠️ Sync', 'No se pudo sincronizar el cliente. Se reintentará.', 'warning');
    });
    return newCustomer.id;
  };

  const updateCustomer = (id: string, data: Partial<Customer>) => {
    setCustomers(prev =>
      prev.map(c => (c.id === id ? { ...c, ...data, updated_at: new Date().toISOString() } : c))
    );
    getApi().customers.update(id, {
      name: data.name,
      // Trim and coerce empty strings to null so we don't persist '' as the
      // contact value when the form leaves the field blank.
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: (data.type != null ? (localToBackendType[data.type] ?? data.type) : undefined) as any,
      credit_limit: data.credit_limit ?? undefined,
      // Only ship is_active when the caller actually changed status; otherwise
      // a partial update like { name } would silently deactivate the customer.
      ...(data.status !== undefined ? { is_active: data.status === 'active' } : {}),
    }).catch(() => {
      notify('⚠️ Sync', 'No se pudo sincronizar el cliente. Se reintentará.', 'warning');
    });
  };

  // Backend stores customer type in English; the UI uses Spanish. Without this
  // mapping clients loaded from D1 would render the raw English value.
  const backendToLocalType: Record<string, Customer['type']> = {
    consumer: 'consumidor_final',
    wholesale: 'mayorista',
    frequent: 'frecuente',
    corporate: 'empresa',
  };

  const loadCustomersFromD1 = () => {
    fetchCustomersFromD1()
      .then(d1Customers => {
        if (d1Customers.length === 0) return;
        const normalized = d1Customers.map(raw => ({
          ...raw,
          type: backendToLocalType[raw.type as string] ?? raw.type,
        })) as Customer[];
        // Bug 10 fix: merge by updated_at so edits made on other devices
        // overwrite stale local copies rather than being silently ignored.
        setCustomers(prev => {
          const prevMap = new Map(prev.map(c => [c.id, c]));
          for (const d1Customer of normalized) {
            const local = prevMap.get(d1Customer.id);
            if (
              !local ||
              (d1Customer.updated_at && local.updated_at && d1Customer.updated_at > local.updated_at)
            ) {
              prevMap.set(d1Customer.id, d1Customer);
            }
          }
          return Array.from(prevMap.values());
        });
      })
      .catch((e: unknown) => {
        console.warn('[useCustomers] loadCustomersFromD1 error:', e);
      });
  };

  return { customers, setCustomers, addCustomer, updateCustomer, loadCustomersFromD1 };
}
