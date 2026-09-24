import { useState, useEffect } from 'react';

import { applySaleConfirmation, type SaleConfirmation } from '../services/sale-confirmation';
import type { Sale } from '../types';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

export function useSales() {
  const [sales, setSales] = useState<Sale[]>(() =>
    safeParseLocalStorage<Sale[]>('pan_erp_sales', [])
  );

  useEffect(() => {
    safeSetItem('pan_erp_sales', JSON.stringify(sales));
  }, [sales]);

  useEffect(() => {
    const onSynced = (event: Event) => {
      const confirmation = (event as CustomEvent<SaleConfirmation>).detail;
      setSales(previous => applySaleConfirmation(previous, confirmation));
    };
    window.addEventListener('sale-synced', onSynced);
    return () => window.removeEventListener('sale-synced', onSynced);
  }, []);
  return { sales, setSales };
}
