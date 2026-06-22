import * as React from 'react';

import type { Product, Sale } from '../../types';
import { formatCurrency } from '../../utils/format';

// Extraído desde Dashboard.tsx (`renderWidgetPresentaciones`).
// La regla T5.2 (no renderizar si no hay ventas con presentación) se preserva
// devolviendo `null` desde el componente — el padre simplemente no muestra nada.
export interface PresentationsWidgetProps {
  products: Product[];
  successfulSales: Sale[];
}

type PresentationStat = { units: number; revenue: number };
type ProductStat = {
  name: string;
  image: string;
  presentations: Map<string, PresentationStat>;
  totalUnits: number;
  totalRevenue: number;
  hasPresentation: boolean;
};

export const PresentationsWidget: React.FC<PresentationsWidgetProps> = ({ products, successfulSales }) => {
  const byProduct = new Map<string, ProductStat>();

  successfulSales.forEach(sale => {
    sale.items.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (!prod) return;
      const stat = byProduct.get(prod.id) ?? {
        name: prod.name,
        image: prod.image,
        presentations: new Map<string, PresentationStat>(),
        totalUnits: 0,
        totalRevenue: 0,
        hasPresentation: false,
      };
      const key = item.presentation ?? 'Unidad';
      if (item.presentation) stat.hasPresentation = true;
      const presStat = stat.presentations.get(key) ?? { units: 0, revenue: 0 };
      presStat.units += item.quantity;
      presStat.revenue += item.subtotal;
      stat.presentations.set(key, presStat);
      stat.totalUnits += item.quantity;
      stat.totalRevenue += item.subtotal;
      byProduct.set(prod.id, stat);
    });
  });

  const productsWithPresentation = Array.from(byProduct.entries())
    .filter(([, s]) => s.hasPresentation)
    .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue);

  if (productsWithPresentation.length === 0) return null;

  return (
    <div key="presentaciones" className="bg-white dark:bg-zinc-900 border border-orange-100/45 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-100 flex items-center gap-2">
          📦 Desglose de Ventas por Presentación
        </h3>
        <span className="text-[10px] text-gray-400 font-bold">{productsWithPresentation.length} ARTÍCULOS</span>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {productsWithPresentation.map(([prodId, stat]) => (
          <div key={prodId} className="border border-gray-100 dark:border-zinc-800 rounded-xl p-3 bg-gray-50/40 dark:bg-zinc-950/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl" role="img" aria-hidden="true">{stat.image}</span>
                <h4 className="font-extrabold text-xs text-gray-800 dark:text-zinc-100 truncate">{stat.name}</h4>
              </div>
              <span className="text-[10px] text-amber-600 dark:text-amber-500 font-extrabold font-mono">
                {formatCurrency(stat.totalRevenue)}
              </span>
            </div>
            <div className="space-y-1">
              {Array.from(stat.presentations.entries())
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([presName, presStat]) => {
                  const pct = stat.totalRevenue > 0 ? (presStat.revenue / stat.totalRevenue) * 100 : 0;
                  return (
                    <div key={presName} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="flex items-center gap-1.5 font-bold text-gray-600 dark:text-zinc-300 truncate min-w-0">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${presName === 'Unidad' ? 'bg-gray-400' : 'bg-amber-500'}`} />
                        <span className="truncate">{presName}</span>
                      </span>
                      <div className="flex items-center gap-2 shrink-0 font-mono">
                        <span className="text-gray-500">{presStat.units} u.</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{formatCurrency(presStat.revenue)}</span>
                        <span className="text-gray-400 text-[9px]">({pct.toFixed(0)}%)</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
