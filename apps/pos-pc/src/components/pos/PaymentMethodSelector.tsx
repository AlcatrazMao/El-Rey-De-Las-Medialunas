import * as React from 'react';

import type { PaymentMethodConfig } from '../../hooks/useSettings';
import type { PaymentGateway, Sale } from '../../types';

interface PaymentMethodSelectorProps {
  paymentMethods: PaymentMethodConfig[];
  paymentMethod: Sale['paymentMethod'];
  setPaymentMethod: (id: Sale['paymentMethod']) => void;
  gateways: PaymentGateway[];
}

/**
 * Grilla de botones para elegir el método de cobro. Sólo presentación: toda
 * la lógica (cálculos, validaciones, ajustes) sigue viviendo en POSView. Este
 * componente recibe la lista ya filtrada por `enabled` desde el padre.
 *
 * Comportamiento clonado 1:1 del JSX original:
 *   - Tarjeta queda inactiva si el gateway Stripe está inactive
 *   - Recargo/descuento se muestra como sub-label en el botón
 *   - Botón deshabilitado conserva los estilos opaque + cursor-not-allowed
 */
export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  paymentMethods,
  paymentMethod,
  setPaymentMethod,
  gateways,
}) => {
  return (
    <div className="mb-4">
      <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-2">Método de Cobro (Integrado)</label>
      <div className="grid grid-cols-2 gap-2">
        {paymentMethods
          .filter((pm) => pm.enabled)
          .map((pm) => {
            const matchesSelected = paymentMethod === pm.id;
            // Sólo la tarjeta sigue ligada a una pasarela activa (Stripe).
            // Transferencia es manual y no depende de gateway externo.
            let isGatewayActive = true;
            if (pm.id === 'tarjeta') {
              const g = gateways.find(g => g.id === 'gate_stripe');
              isGatewayActive = g ? g.status === 'active' : true;
            }
            const showAdjustment = pm.adjustmentType !== 'none' && pm.adjustmentPercent > 0;
            const adjLabel = pm.adjustmentType === 'recargo'
              ? `+${pm.adjustmentPercent}% recargo`
              : `-${pm.adjustmentPercent}% descuento`;
            return (
              <button
                key={pm.id}
                id={`btn-pm-choice-${pm.id}`}
                onClick={() => setPaymentMethod(pm.id as Sale['paymentMethod'])}
                disabled={!isGatewayActive}
                className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-left flex items-center justify-between cursor-pointer ${
                  matchesSelected
                    ? 'bg-amber-100 hover:bg-amber-100/90 text-amber-900 border-amber-400'
                    : !isGatewayActive
                    ? 'bg-gray-100 dark:bg-zinc-950/20 text-gray-400 dark:text-zinc-600 border-gray-200 dark:border-zinc-800 opacity-40 cursor-not-allowed'
                    : 'bg-white dark:bg-zinc-850 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-zinc-800'
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate flex items-center gap-1.5 shrink-0">
                    <span>{pm.icon}</span> <span>{pm.label}</span>
                  </p>
                  {showAdjustment && (
                    <span className={`text-[8px] block leading-tight ${pm.adjustmentType === 'recargo' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{adjLabel}</span>
                  )}
                  {!isGatewayActive && <span className="text-[8px] text-amber-600 block leading-tight">Inactiva</span>}
                </div>
              </button>
            );
          })}
      </div>

    </div>
  );
};
