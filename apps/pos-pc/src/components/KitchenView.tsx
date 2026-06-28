import React, { useEffect, useState, useCallback } from 'react';
import { ChefHat, Clock, CheckCircle2, RefreshCw, ShoppingBag, Home } from 'lucide-react';

import { useApp } from '../AppContext';
import type { Sale } from '../types';

const PREPARED_KEY = 'kitchen_prepared_ids';

function getPreparedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PREPARED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function savePreparedIds(ids: Set<string>) {
  try {
    localStorage.setItem(PREPARED_KEY, JSON.stringify([...ids]));
  } catch { /* noop */ }
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export const KitchenView: React.FC = () => {
  const { sales: allSales } = useApp();
  const [preparedIds, setPreparedIds] = useState<Set<string>>(getPreparedIds);
  const [filter, setFilter] = useState<'all' | 'pending' | 'ready'>('pending');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const today = new Date().toDateString();

  const sales: Sale[] = allSales
    .filter(s =>
      s.paymentStatus === 'completed' &&
      new Date(s.date).toDateString() === today
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const refresh = useCallback(() => {
    setLastRefresh(new Date());
  }, []);

  // Auto-refresh cada 30s para que el cocinero vea pedidos nuevos sin recargar
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Limpiar IDs de días anteriores al montar o cuando cambia la lista del día
  useEffect(() => {
    const todayIds = new Set(sales.map(s => s.id));
    setPreparedIds(prev => {
      const cleaned = new Set([...prev].filter(id => todayIds.has(id)));
      savePreparedIds(cleaned);
      return cleaned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when sales list changes
  }, [sales.length]);

  const markPrepared = (id: string) => {
    setPreparedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      savePreparedIds(next);
      return next;
    });
  };

  const unmarkPrepared = (id: string) => {
    setPreparedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      savePreparedIds(next);
      return next;
    });
  };

  const filteredSales = sales.filter(s => {
    const isPrepared = preparedIds.has(s.id);
    if (filter === 'pending') return !isPrepared;
    if (filter === 'ready') return isPrepared;
    return true;
  });

  const pendingCount = sales.filter(s => !preparedIds.has(s.id)).length;

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-zinc-950">

      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-amber-500" />
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Panel de Cocina</h1>
          {pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            Actualizado {formatTime(lastRefresh.toISOString())}
          </span>
          <button
            onClick={refresh}
            className="text-gray-400 hover:text-amber-500 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="px-4 py-2 flex gap-2 shrink-0 bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800">
        {([
          { key: 'pending', label: 'Pendientes' },
          { key: 'ready', label: 'Listos' },
          { key: 'all', label: 'Todos' },
        ] as const).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              filter === f.key
                ? 'bg-amber-500 text-white border-amber-600'
                : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:border-amber-400'
            }`}
          >
            {f.label}
            {f.key === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
          </button>
        ))}
      </div>

      {/* Lista de pedidos */}
      <div className="flex-1 overflow-y-auto p-4">
        {!filteredSales.length && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-zinc-600 gap-3">
            <ChefHat className="h-12 w-12" />
            <p className="text-sm font-medium">
              {filter === 'pending' ? 'No hay pedidos pendientes' : filter === 'ready' ? 'No hay pedidos listos' : 'No hay pedidos hoy'}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSales.map(sale => {
            const isPrepared = preparedIds.has(sale.id);
            const isLlevar = sale.delivery_type === 'llevar';

            return (
              <div
                key={sale.id}
                className={`bg-white dark:bg-zinc-900 rounded-2xl border-2 p-4 flex flex-col gap-3 transition-all ${
                  isPrepared
                    ? 'border-emerald-200 dark:border-emerald-900 opacity-60'
                    : 'border-amber-300 dark:border-amber-800 shadow-sm'
                }`}
              >
                {/* Cabecera del pedido */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                        #{(sale.invoiceNumber ?? sale.id ?? '').slice(-6)}
                      </span>
                      {/* Badge para llevar / aquí */}
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        isLlevar
                          ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                          : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
                      }`}>
                        {isLlevar ? <ShoppingBag className="h-2.5 w-2.5" /> : <Home className="h-2.5 w-2.5" />}
                        {isLlevar ? 'Para llevar' : 'Retiran'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400 dark:text-zinc-500">
                      <Clock className="h-3 w-3" />
                      <span>{sale.date ? formatTime(sale.date) : '—'}</span>
                      {sale.customerName && sale.customerName !== 'Consumidor Final' && sale.customerName !== 'Anónimo' && (
                        <span>· {sale.customerName}</span>
                      )}
                    </div>
                  </div>
                  {isPrepared && (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  )}
                </div>

                {/* Ítems */}
                <div className="flex flex-col gap-1">
                  {(sale.items ?? []).map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="font-bold text-amber-600 dark:text-amber-400 w-6 text-right shrink-0">
                        {item.quantity}×
                      </span>
                      <span className="text-gray-800 dark:text-zinc-200 font-medium truncate">
                        {item.name ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Observaciones */}
                {sale.notes && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                    <p className="text-xs text-amber-800 dark:text-amber-300 italic">
                      📝 {sale.notes}
                    </p>
                  </div>
                )}

                {/* Botón acción */}
                <button
                  onClick={() => isPrepared ? unmarkPrepared(sale.id) : markPrepared(sale.id)}
                  className={`w-full py-2 rounded-xl text-sm font-bold transition-all ${
                    isPrepared
                      ? 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {isPrepared ? '↩ Marcar pendiente' : '✓ Listo'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default KitchenView;
