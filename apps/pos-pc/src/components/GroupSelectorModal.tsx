import { X, Package2 } from 'lucide-react';
import * as React from 'react';

import type { Product, ProductGroup } from '../types';
import { formatCurrency } from '../utils/format';

import { GroupCard } from './GroupCard';

interface GroupSelectorModalProps {
  product: Product;
  onSelectUnit: () => void;
  onSelectGroup: (group: ProductGroup) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet de selección de presentación: muestra la opción "Unidad" + una
 * tarjeta por cada grupo configurado en el producto. Se anima desde abajo en
 * mobile y se centra como modal en desktop.
 */
export const GroupSelectorModal: React.FC<GroupSelectorModalProps> = ({
  product,
  onSelectUnit,
  onSelectGroup,
  onClose,
}) => {
  const groups = (product.groups ?? []).slice().sort((a, b) => a.orden - b.orden);

  return (
    <div
      className="fixed inset-0 z-55 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-150 dark:border-zinc-800 max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-3xl shrink-0" role="img" aria-label={product.name}>
              {product.image}
            </span>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-50 truncate">
                {product.name}
              </h3>
              <p className="text-[10px] text-gray-400">Elegí la presentación</p>
            </div>
          </div>
          <button
            type="button"
            id="btn-group-modal-close"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-500 hover:text-gray-700 dark:hover:text-zinc-200 cursor-pointer transition-colors shrink-0 ml-2"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
          {/* Tarjeta "Unidad" siempre primera */}
          <button
            type="button"
            id="btn-group-unidad"
            onClick={onSelectUnit}
            className="w-full text-left p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-850 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50/40 dark:hover:bg-amber-950/10 transition-all cursor-pointer active:scale-97"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <Package2 className="h-4 w-4 text-gray-500" />
                <h4 className="font-extrabold text-base text-gray-900 dark:text-zinc-50">Unidad</h4>
              </div>
              <p className="font-extrabold text-base text-amber-600 dark:text-amber-500 font-mono">
                {formatCurrency(product.price)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              <span className="bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">
                1 u.
              </span>
              <span className="text-gray-400">Venta individual</span>
            </div>
          </button>

          {/* Tarjetas por grupo */}
          {groups.length === 0 ? (
            <p className="text-center text-[11px] text-gray-400 italic py-4">
              No hay presentaciones adicionales configuradas para este producto.
            </p>
          ) : (
            groups.map((g) => (
              <GroupCard
                key={g.id}
                unitPrice={product.price}
                group={g}
                onSelect={() => onSelectGroup(g)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 shrink-0">
          <button
            type="button"
            id="btn-group-modal-cancel"
            onClick={onClose}
            className="w-full py-2.5 bg-zinc-900 dark:bg-zinc-200 dark:text-zinc-955 text-white rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer transition-opacity"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
