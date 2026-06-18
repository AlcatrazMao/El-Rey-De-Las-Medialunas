import { useState, useEffect } from 'react';

import { INITIAL_SALES } from '../initialData';
import type { Sale } from '../types';
import { safeSetItem } from '../utils/safeStorage';

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

export function useSales() {
  const [sales, setSales] = useState<Sale[]>(() =>
    safeParse<Sale[]>('pan_erp_sales', INITIAL_SALES)
  );

  useEffect(() => {
    safeSetItem('pan_erp_sales', JSON.stringify(sales));
  }, [sales]);

  return { sales, setSales };
}
