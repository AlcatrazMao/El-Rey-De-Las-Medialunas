import { Truck, DollarSign, Wallet } from 'lucide-react';
import React, { useMemo } from 'react';

import { useRequests } from '../hooks/useRequests';

import { RequestsView } from './RequestsView';

/**
 * Vista de entregas para el rol repartidor.
 *
 * Muestra:
 *  - Resumen del día: total cobrado y total gastado en entregas activas/completadas hoy.
 *  - La lista filtrada por type='delivery' usando el mismo RequestsView (misma UX
 *    de aceptar/completar/arrepentirse).
 *
 * Cuando se complete una solicitud delivery se puede ingresar `cost_spent` —
 * por convención: positivo = cobro recibido. La ruta con mapas viene después.
 */
export const DeliveryView: React.FC = () => {
  const { requests } = useRequests();

  const summary = useMemo(() => {
    const todayStr = new Date().toDateString();
    const todayDeliveries = requests.filter(r => {
      if (r.type !== 'delivery') return false;
      const reference = r.time_completed ?? r.updated_at ?? r.created_at;
      return reference && new Date(reference).toDateString() === todayStr;
    });
    let cobrado = 0;
    let gastado = 0;
    for (const r of todayDeliveries) {
      if (typeof r.cost_spent !== 'number') continue;
      // Convención simple: positivo = cobro, negativo = gasto.
      // Esto se ajusta cuando agreguemos el toggle "fue cobro" en el form.
      if (r.cost_spent >= 0) cobrado += r.cost_spent;
      else gastado += Math.abs(r.cost_spent);
    }
    return { cobrado, gastado, count: todayDeliveries.length };
  }, [requests]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-zinc-950">
      {/* Header con balance del día */}
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Truck className="h-5 w-5 text-blue-500" />
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Mis entregas</h1>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard
            label="Entregas hoy"
            value={String(summary.count)}
            icon={<Truck className="h-4 w-4 text-blue-500" />}
            tone="blue"
          />
          <SummaryCard
            label="Cobrado"
            value={`$${summary.cobrado.toFixed(2)}`}
            icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
            tone="emerald"
          />
          <SummaryCard
            label="Gastado"
            value={`$${summary.gastado.toFixed(2)}`}
            icon={<Wallet className="h-4 w-4 text-rose-500" />}
            tone="rose"
          />
        </div>
      </div>

      {/* Reutilizamos RequestsView con filtro por tipo */}
      <div className="flex-1 min-h-0">
        <RequestsView typeFilter="delivery" />
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'blue' | 'emerald' | 'rose';
}> = ({ label, value, icon, tone }) => {
  const toneCls = {
    blue:    'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40',
    rose:    'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40',
  }[tone];
  return (
    <div className={`border rounded-xl p-2 ${toneCls}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">{label}</span>
      </div>
      <div className="text-sm font-bold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
};

export default DeliveryView;
