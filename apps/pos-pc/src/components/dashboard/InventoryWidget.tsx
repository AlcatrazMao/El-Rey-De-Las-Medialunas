import * as React from 'react';

import type { Ingredient } from '../../types';

// Extraído desde Dashboard.tsx (`renderWidgetInventario`). JSX preservado uno-a-uno.
// Recibe únicamente la lista de ingredientes ya derivada por el padre.
export interface InventoryWidgetProps {
  ingredients: Ingredient[];
}

export const InventoryWidget: React.FC<InventoryWidgetProps> = ({ ingredients }) => {
  return (
    <div key="inventario" className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
      <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-100 flex items-center gap-2 mb-4">
        🌾 Monitor de Materia Prima en Silos
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {ingredients.slice(0, 6).map(ing => {
          const isAlert = ing.stock <= ing.minStock;
          return (
            <div key={ing.id} className={`p-3 rounded-xl border ${isAlert ? 'bg-red-50/15 border-red-200 dark:bg-red-950/10' : 'bg-gray-50/50 dark:bg-zinc-950/30'}`}>
              <p className="text-[10px] text-gray-500 font-bold truncate">{ing.name}</p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className={`text-base font-black ${isAlert ? 'text-red-500' : 'text-gray-800 dark:text-zinc-100'}`}>
                  {ing.stock.toFixed(1)}
                </span>
                <span className="text-[9px] text-gray-400 font-bold">{ing.unit}</span>
              </div>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${isAlert ? 'bg-red-100 text-red-800 dark:bg-red-950/30' : 'bg-emerald-100 text-emerald-850 dark:bg-emerald-950/30'}`}>
                {isAlert ? 'Comprar ya' : 'Suficiente'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
