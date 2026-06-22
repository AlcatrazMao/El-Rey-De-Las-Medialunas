import * as React from 'react';

import type { Product, Sale } from '../../types';
import { buildCategoryStats } from '../../utils/dashboardStats';
import { formatCurrency } from '../../utils/format';

// Extraído desde Dashboard.tsx (`renderWidgetContabilidad`).
// `categoryStats` se deriva dinámicamente de los productos para soportar
// categorías nuevas sin tocar este componente.
export interface AccountingWidgetProps {
  products: Product[];
  successfulSales: Sale[];
}

const KNOWN_TITLES: Record<string, string> = {
  panes: '🥖 Panes',
  facturas: '🥐 Facturas',
  pasteleria: '🍰 Pastelería',
  salados: '🥪 Salados',
  bebidas: '☕ Bebidas',
};
const KNOWN_COLORS: Record<string, string> = {
  panes: 'bg-amber-500',
  facturas: 'bg-orange-500',
  pasteleria: 'bg-rose-500',
  salados: 'bg-emerald-500',
  bebidas: 'bg-sky-500',
};

const titleFor = (key: string) => KNOWN_TITLES[key] ?? `📦 ${key.charAt(0).toUpperCase()}${key.slice(1)}`;
const colorFor = (key: string) => KNOWN_COLORS[key] ?? 'bg-slate-500';

export const AccountingWidget: React.FC<AccountingWidgetProps> = ({ products, successfulSales }) => {
  const categoryStats = buildCategoryStats(products, successfulSales);
  const categories = Object.keys(categoryStats);
  const values = Object.values(categoryStats);
  const maxVal = Math.max(...values, 20);

  return (
    <div key="contabilidad" className="bg-white dark:bg-zinc-900 border border-orange-100/45 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-100 flex items-center gap-2">
          📊 Volumen de Facturación por Categoría de Panificados
        </h3>
        <span className="text-[10px] text-gray-400 font-bold">MONITOREO EN VIVO</span>
      </div>

      <div className="relative h-56 w-full flex items-end justify-between gap-2 border-b border-gray-200 dark:border-zinc-800 pb-2 pt-4">
        {categories.map((catKey, idx) => {
          const val = categoryStats[catKey];
          const heightPct = Math.max((val / maxVal) * 80, 5);
          const title = titleFor(catKey);

          return (
            <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="text-[10px] font-mono font-bold text-gray-700 dark:text-zinc-300 mb-1.5">{formatCurrency(val)}</span>
              <div
                className={`w-11 md:w-16 rounded-t-lg transition-all duration-500 ${colorFor(catKey)} shadow-xs hover:opacity-90 cursor-pointer`}
                style={{ height: `${heightPct}%` }}
                title={`${title}: ${formatCurrency(val)}`}
              />
              <span className="text-[10px] font-bold text-gray-500 mt-2 truncate max-w-full text-center">
                {title.split(' ').slice(1).join(' ') || catKey}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
