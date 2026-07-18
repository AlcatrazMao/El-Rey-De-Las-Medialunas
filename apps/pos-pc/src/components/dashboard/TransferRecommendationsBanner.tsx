import { ArrowLeftRight, Lightbulb } from 'lucide-react';
import * as React from 'react';

import { useTransferRecommendations } from '../../hooks/useTransfers';

/**
 * Banner de recomendaciones de traslado (TR-2 en la spec): cuando un producto
 * está en/por debajo del mínimo en la sucursal activa y otra sucursal tiene
 * superávit, el backend sugiere un traslado. Mismo estilo visual que el resto
 * de las alertas del Dashboard (ver "lotes vencen" arriba, StockAlertList).
 *
 * No bloquea el resto del dashboard si falla — es informativo, se degrada a
 * "sin sugerencias" silenciosamente (ver useTransferRecommendations).
 */
export const TransferRecommendationsBanner: React.FC<{
  branchId: string | null;
  onCreateFromRecommendation?: (rec: { productId: string; quantity: number; fromBranchId: string; toBranchId: string }) => void;
}> = ({ branchId, onCreateFromRecommendation }) => {
  const { recommendations } = useTransferRecommendations(branchId);

  if (!branchId || recommendations.length === 0) return null;

  return (
    <div
      id="dashboard-transfer-recommendations"
      className="bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-300 dark:border-cyan-900/50 rounded-2xl p-4 shadow-xs"
    >
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
        <h3 className="font-extrabold text-sm text-cyan-800 dark:text-cyan-300">
          {recommendations.length} traslado{recommendations.length === 1 ? '' : 's'} sugerido{recommendations.length === 1 ? '' : 's'}
        </h3>
      </div>
      <p className="text-[10px] text-cyan-700/80 dark:text-cyan-400/80 font-semibold mb-2">
        Stock bajo acá y superávit en otra sucursal — considerá pedir un traslado.
      </p>
      <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
        {recommendations.slice(0, 10).map((rec, idx) => (
          <li
            key={`${rec.product_id}-${rec.from_branch_id}-${idx}`}
            className="flex items-center justify-between gap-2 text-[11px] bg-white dark:bg-zinc-950/40 rounded-lg px-2 py-1.5 border border-cyan-100 dark:border-cyan-900/30"
          >
            <span className="font-bold text-gray-800 dark:text-zinc-200 truncate flex-1">
              {rec.product_name}
            </span>
            <span className="font-mono text-cyan-700 dark:text-cyan-300 shrink-0">
              {rec.suggested_qty}u desde {rec.from_branch_name ?? rec.from_branch_id}
            </span>
            {onCreateFromRecommendation && (
              <button
                onClick={() => onCreateFromRecommendation({
                  productId: rec.product_id,
                  quantity: rec.suggested_qty,
                  fromBranchId: rec.from_branch_id,
                  toBranchId: rec.to_branch_id,
                })}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                <ArrowLeftRight className="h-3 w-3" /> Crear
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TransferRecommendationsBanner;
