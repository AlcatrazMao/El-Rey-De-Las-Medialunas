import { TrendingUp } from 'lucide-react';
import * as React from 'react';

import { formatCurrency } from '../../utils/format';

// Extraído desde Dashboard.tsx (`renderWidgetFacturacion`). El JSX se preservó
// uno-a-uno; los inputs se reciben como props pre-calculados desde el padre.
export interface SalesSummaryCardProps {
  totalRevenue: number;
  totalExpenses: number;
  totalInsumosSobrantesValue: number;
}

export const SalesSummaryCard: React.FC<SalesSummaryCardProps> = ({
  totalRevenue,
  totalExpenses,
  totalInsumosSobrantesValue,
}) => {
  return (
    <div key="facturacion" className="grid grid-cols-1 sm:grid-cols-3 gap-4">

      {/* Rev */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-505 rounded-xl border border-emerald-100">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Ventas Cobradas</p>
            <p className="text-lg font-black text-gray-805 dark:text-zinc-50 mt-0.5">{formatCurrency(totalRevenue)}</p>
          </div>
        </div>
        <span className="text-xs text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-950/10 px-2 py-1 rounded">
          —
        </span>
      </div>

      {/* Exp */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-505 rounded-xl border border-red-100 font-bold">
            📉
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Egresos / Gastos</p>
            <p className="text-lg font-black text-gray-850 dark:text-zinc-50 mt-0.5">{formatCurrency(totalExpenses)}</p>
          </div>
        </div>
        <span className="text-xs text-red-500 font-bold bg-red-50 dark:bg-red-950/10 px-2 py-1 rounded">
          —
        </span>
      </div>

      {/* Insumos */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-650 rounded-xl border border-amber-100">
            🌾
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Valorización Insumo</p>
            <p className="text-lg font-black text-gray-850 dark:text-zinc-50 mt-0.5">{formatCurrency(totalInsumosSobrantesValue)}</p>
          </div>
        </div>
        <span className="text-xs text-amber-600 dark:text-amber-500 font-bold bg-amber-50 dark:bg-amber-950/10 px-2 py-1 rounded">
          Reserva
        </span>
      </div>

    </div>
  );
};
