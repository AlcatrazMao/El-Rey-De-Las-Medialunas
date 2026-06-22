import * as React from 'react';

import type { Sale } from '../../types';
import { formatCurrency } from '../../utils/format';

// Extraído desde Dashboard.tsx (`renderWidgetHistorico`). Recibe sólo el subset
// de ventas exitosas que el padre ya derivó para que el componente sea dumb.
export interface RecentSalesTableProps {
  successfulSales: Sale[];
}

export const RecentSalesTable: React.FC<RecentSalesTableProps> = ({ successfulSales }) => {
  return (
    <div key="historico" className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
      <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-100 flex items-center gap-2 mb-3">
        🧾 Últimas Transacciones del Día
      </h3>
      <div className="divide-y divide-gray-100 dark:divide-zinc-800 space-y-2">
        {successfulSales.slice(0, 4).map((sale, i) => (
          <div key={i} className="pt-2 flex items-center justify-between text-xs">
            <div>
              <p className="font-bold text-gray-800 dark:text-zinc-200">{sale.invoiceNumber}</p>
              <p className="text-[9px] text-gray-400 capitalize">{sale.customerName || 'Consumidor Final'} • {sale.paymentMethod.replace('_', ' ')}</p>
            </div>
            <span className="font-mono font-black text-amber-600 dark:text-amber-500">{formatCurrency(sale.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
