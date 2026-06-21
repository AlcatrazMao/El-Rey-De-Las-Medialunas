import { useState, useEffect } from 'react';

import { INITIAL_SALES } from '../initialData';
import type { Sale } from '../types';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

export function useSales() {
  const [sales, setSales] = useState<Sale[]>(() =>
    safeParseLocalStorage<Sale[]>('pan_erp_sales', INITIAL_SALES)
  );

  useEffect(() => {
    safeSetItem('pan_erp_sales', JSON.stringify(sales));
  }, [sales]);

  return { sales, setSales };
}
