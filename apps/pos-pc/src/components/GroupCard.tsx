import * as React from 'react';

import type { ProductGroup } from '../types';
import { formatCurrency } from '../utils/format';
import { calcularPrecioBase, calcularTotalFinal } from '../utils/productGroups';

interface GroupCardProps {
  unitPrice: number;
  group: ProductGroup;
  onSelect: () => void;
  highlighted?: boolean;
}

/**
 * Tarjeta de selección de un grupo de venta (presentación).
 * Diseño: nombre + total_final prominentes, cantidad/descuento secundarios.
 */
export const GroupCard: React.FC<GroupCardProps> = ({ unitPrice, group, onSelect, highlighted }) => {
  const base = calcularPrecioBase(unitPrice, group);
  const total = calcularTotalFinal(unitPrice, group);
  const hasDiscount = total < base;
  const ahorro = parseFloat((base - total).toFixed(2));

  return (
    <button
      type="button"
      onClick={onSelect}
      id={`btn-group-card-${group.id}`}
      className={`w-full text-left p-4 rounded-2xl border transition-all cursor-pointer active:scale-97 ${
        highlighted
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-400 dark:border-amber-600 shadow-md'
          : 'bg-white dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50/40 dark:hover:bg-amber-950/10'
      }`}
    >
      {/* PROMINENT: nombre + total_final */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="font-extrabold text-base text-gray-900 dark:text-zinc-50 leading-tight">
          {group.nombre}
        </h4>
        <div className="text-right shrink-0">
          <p className="font-extrabold text-base text-amber-600 dark:text-amber-500 font-mono">
            {formatCurrency(total)}
          </p>
          {hasDiscount && (
            <p className="text-[10px] text-gray-400 line-through font-mono">{formatCurrency(base)}</p>
          )}
        </div>
      </div>

      {/* SECONDARY: cantidad / descuento */}
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
        <span className="bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">
          {group.cantidad} u.
        </span>
        {group.descuento > 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
            {group.descuento_tipo === 'porcentaje'
              ? `-${group.descuento}%`
              : `- ${formatCurrency(group.descuento)}`}
            {hasDiscount && ahorro > 0 && (
              <span className="ml-1 text-[10px] text-gray-400 font-normal">
                (ahorrás {formatCurrency(ahorro)})
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-400">Sin descuento</span>
        )}
      </div>

      {group.admite_acum_desc === 1 && (
        <p className="mt-1.5 text-[9px] uppercase tracking-wider font-bold text-amber-700 dark:text-amber-400">
          Admite descuento acumulado
        </p>
      )}
    </button>
  );
};
