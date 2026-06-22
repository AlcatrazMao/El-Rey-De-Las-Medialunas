import { AlertTriangle, Check } from 'lucide-react';
import * as React from 'react';

import type { Ingredient, Sale } from '../../types';

// Extraído desde Dashboard.tsx (`renderWidgetAlertas`). El padre pasa los
// inputs y el componente sólo deriva los filtros visuales sin tocar estado.
export interface StockAlertListProps {
  ingredients: Ingredient[];
  sales: Sale[];
}

export const StockAlertList: React.FC<StockAlertListProps> = ({ ingredients, sales }) => {
  const lowStockItems = ingredients.filter((i) => i.stock <= i.minStock);
  const failedPaymentsCount = sales.filter((s) => s.paymentStatus === 'failed').length;

  return (
    <div key="alertas" className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
      <h3 className="font-extrabold text-sm text-gray-[850] dark:text-zinc-100 flex items-center gap-2 mb-3">
        🚨 Monitor de Alertas de Producción
      </h3>

      {lowStockItems.length === 0 && failedPaymentsCount === 0 ? (
        <div className="text-center py-8 text-emerald-600">
          <Check className="h-8 w-8 mx-auto mb-1 animate-bounce" />
          <p className="text-xs font-bold leading-none">Cero alertas activas</p>
          <p className="text-[10px] text-gray-400 mt-1">Todas las harinas y balanzas están óptimas</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {lowStockItems.map((item) => (
            <div key={item.id} className="p-2 bg-red-50 dark:bg-red-950/15 border border-red-200/50 rounded-xl text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-red-550 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-red-850 dark:text-red-300 leading-snug">Stock crítico: {item.name}</p>
                <p className="text-[10px] text-gray-500">Quedan {item.stock.toFixed(2)} {item.unit} (Umbral de aviso: {item.minStock} {item.unit})</p>
              </div>
            </div>
          ))}

          {failedPaymentsCount > 0 && (
            <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 rounded-xl text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-amber-800 dark:text-amber-350 leading-snug">{failedPaymentsCount} Rechazos Financieros</p>
                <p className="text-[10px] text-gray-500">Operaciones con PayPal o Stripe fueron canceladas por falta de fondos simulada.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
