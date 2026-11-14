import {
  History,
  ArrowDownRight,
  ArrowUpRight,
  Search,
  Download,
  RefreshCw,
  SlidersHorizontal,
  Calendar,
  Cloud,
  Clock,
  Package,
  Layers,
  ArrowUpDown
} from 'lucide-react';
import * as React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';

import { useApp } from '../../AppContext';
import { getApi } from '../../services/api';
import { dbAdapter } from '../../services/db-adapter';
import type { Product } from '../../types';
import { exportKardexToCSV, type KardexExportItem } from '../../utils/exportUtils';

export interface UnifiedMovement {
  id: string;
  productId: string;
  productName: string;
  productCode?: string;
  productUnit: string;
  productImage?: string;
  movementType: string;
  quantity: number; // positive value
  isInbound: boolean;
  delta: number; // + or -
  balance?: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  operatorName?: string;
  notes?: string;
  createdAt: string;
  isOfflinePending?: boolean;
}

export interface KardexPanelProps {
  onAdjustStock?: (product: Product, reason?: any) => void;
}

export const KardexPanel: React.FC<KardexPanelProps> = () => {
  const { products, activeUser, addSystemNotification } = useApp();

  const [movements, setMovements] = useState<UnifiedMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Map product dictionary for fast lookups
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  // Fetch movements from API and merge with offline queue
  const fetchMovements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch remote movements
      let remoteMovements: any[] = [];
      try {
        const branchId = activeUser?.branchId || undefined;
        const res = await getApi().inventory.getMovements({
          branch_id: branchId,
          limit: 200,
        });
        if (Array.isArray((res as any)?.data)) {
          remoteMovements = (res as any).data;
        } else if (Array.isArray(res)) {
          remoteMovements = res;
        }
      } catch (apiErr) {
        console.warn('No se pudieron obtener movimientos de la API:', apiErr);
      }

      // 2. Fetch pending local movements from dbAdapter syncQueue
      let localPending: any[] = [];
      try {
        if (dbAdapter?.syncQueue?.where) {
          const queueItems = await dbAdapter.syncQueue
            .where('entity_type')
            .equals('stock_movement')
            .toArray();
          localPending = queueItems.map((item) => {
            const data = (item.data ?? {}) as Record<string, unknown>;
            return {
              id: item.client_id,
              product_id: data.product_id,
              branch_id: data.branch_id,
              movement_type: data.movement_type,
              quantity: data.quantity,
              reason: data.reason,
              notes: data.notes,
              unit_cost_at_time: data.unit_cost_at_time,
              user_id: activeUser?.id,
              user_name: activeUser?.name,
              created_at: item.client_timestamp || new Date().toISOString(),
              is_offline_pending: true,
            };
          });
        }
      } catch (localErr) {
        console.warn('Error leyendo syncQueue local:', localErr);
      }

      // 3. Unify and deduplicate
      const seenIds = new Set<string>();
      const rawList = [...localPending, ...remoteMovements];
      const unifiedList: UnifiedMovement[] = [];

      for (const item of rawList) {
        const id = String(item.id || item.client_id || crypto.randomUUID());
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const prodId = String(item.product_id || item.productId || '');
        const matchedProd = productMap.get(prodId);

        const productName =
          item.product_name ||
          matchedProd?.name ||
          'Producto no identificado';
        const productCode =
          item.product_code || matchedProd?.code || undefined;
        const productUnit =
          item.product_unit || matchedProd?.unit || 'u';
        const productImage = matchedProd?.image || '📦';

        const movType = String(item.movement_type || 'adjustment_in');
        const qty = Math.abs(Number(item.quantity) || 0);

        // Movement direction
        const isInbound =
          movType.endsWith('_in') ||
          movType === 'purchase' ||
          movType === 'production';
        const delta = isInbound ? qty : -qty;

        unifiedList.push({
          id,
          productId: prodId,
          productName,
          productCode,
          productUnit,
          productImage,
          movementType: movType,
          quantity: qty,
          isInbound,
          delta,
          reason: item.reason || item.notes || undefined,
          referenceType: item.reference_type,
          referenceId: item.reference_id,
          operatorName: item.user_name || (item.user_id === activeUser?.id ? activeUser?.name : undefined) || 'Operador',
          notes: item.notes,
          createdAt: item.created_at || new Date().toISOString(),
          isOfflinePending: !!item.is_offline_pending,
        });
      }

      // 4. Calculate stock balance per product
      // Sort chronologically ascending to compute running balances, then we can display in user order
      const byProduct = new Map<string, UnifiedMovement[]>();
      for (const m of unifiedList) {
        const list = byProduct.get(m.productId) || [];
        list.push(m);
        byProduct.set(m.productId, list);
      }

      for (const [prodId, movs] of byProduct.entries()) {
        movs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const prod = productMap.get(prodId);
        // If current product stock is known, adjust backwards or start from base
        let runningStock = prod ? prod.stock : 0;
        // Total delta of all movements
        const totalDelta = movs.reduce((sum, m) => sum + m.delta, 0);
        let baseStock = Math.max(0, runningStock - totalDelta);

        for (const m of movs) {
          baseStock = parseFloat((baseStock + m.delta).toFixed(3));
          m.balance = baseStock;
        }
      }

      setMovements(unifiedList);
    } catch (err) {
      console.error('Error cargando movimientos de Kardex:', err);
      setError('No se pudieron sincronizar los movimientos del servidor.');
    } finally {
      setLoading(false);
    }
  }, [activeUser, productMap]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  // Helpers to resolve human label and visual badge for movement type
  const getMovementBadgeInfo = (mov: UnifiedMovement) => {
    const { movementType, reason } = mov;
    const isRotura = reason && reason.toLowerCase().includes('rotura');

    if (movementType === 'sale_out' || movementType === 'sale') {
      return {
        label: 'Venta',
        badgeClass: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-900/50',
        qtyClass: 'text-rose-600 dark:text-rose-400 font-extrabold',
        sign: '-',
      };
    }
    if (movementType === 'production_in' || movementType === 'production') {
      return {
        label: 'Producción',
        badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50',
        qtyClass: 'text-emerald-600 dark:text-emerald-400 font-extrabold',
        sign: '+',
      };
    }
    if (movementType === 'production_out') {
      return {
        label: 'Consumo Prod.',
        badgeClass: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 border-teal-200 dark:border-teal-900/50',
        qtyClass: 'text-teal-600 dark:text-teal-400 font-extrabold',
        sign: '-',
      };
    }
    if (movementType === 'waste_out' || movementType === 'production_waste' || movementType === 'waste') {
      if (isRotura) {
        return {
          label: 'Rotura',
          badgeClass: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300 border-red-300 dark:border-red-800',
          qtyClass: 'text-red-600 dark:text-red-400 font-extrabold',
          sign: '-',
        };
      }
      return {
        label: 'Merma / Desecho',
        badgeClass: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900/50',
        qtyClass: 'text-red-600 dark:text-red-400 font-extrabold',
        sign: '-',
      };
    }
    if (movementType === 'purchase_in' || movementType === 'purchase') {
      return {
        label: 'Compra / Ingreso',
        badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-900/50',
        qtyClass: 'text-blue-600 dark:text-blue-400 font-extrabold',
        sign: '+',
      };
    }
    if (movementType === 'transfer_in') {
      return {
        label: 'Transferencia (+)',
        badgeClass: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-900/50',
        qtyClass: 'text-purple-600 dark:text-purple-400 font-extrabold',
        sign: '+',
      };
    }
    if (movementType === 'transfer_out') {
      return {
        label: 'Transferencia (-)',
        badgeClass: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/50',
        qtyClass: 'text-indigo-600 dark:text-indigo-400 font-extrabold',
        sign: '-',
      };
    }
    if (movementType === 'adjustment_in') {
      return {
        label: 'Ajuste / Conteo (+)',
        badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50',
        qtyClass: 'text-emerald-600 dark:text-emerald-400 font-extrabold',
        sign: '+',
      };
    }
    if (movementType === 'adjustment_out') {
      return {
        label: 'Ajuste / Conteo (-)',
        badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/50',
        qtyClass: 'text-amber-600 dark:text-amber-400 font-extrabold',
        sign: '-',
      };
    }

    return {
      label: mov.isInbound ? 'Ingreso' : 'Egreso',
      badgeClass: 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300 border-gray-200 dark:border-zinc-700',
      qtyClass: mov.isInbound ? 'text-emerald-600' : 'text-amber-600',
      sign: mov.isInbound ? '+' : '-',
    };
  };

  // Filtered & Sorted movements
  const filteredMovements = useMemo(() => {
    return movements
      .filter((m) => {
        // 1. Text search
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = m.productName.toLowerCase().includes(q);
          const matchCode = m.productCode?.toLowerCase().includes(q);
          const matchReason = m.reason?.toLowerCase().includes(q);
          const matchNotes = m.notes?.toLowerCase().includes(q);
          const matchOperator = m.operatorName?.toLowerCase().includes(q);
          if (!matchName && !matchCode && !matchReason && !matchNotes && !matchOperator) {
            return false;
          }
        }

        // 2. Type filter
        if (typeFilter !== 'all') {
          if (typeFilter === 'sales' && !m.movementType.startsWith('sale')) return false;
          if (typeFilter === 'production' && !m.movementType.startsWith('production')) return false;
          if (typeFilter === 'waste' && !m.movementType.includes('waste') && !m.reason?.toLowerCase().includes('rotura') && !m.reason?.toLowerCase().includes('merma')) {
            return false;
          }
          if (typeFilter === 'adjustments' && !m.movementType.startsWith('adjustment')) return false;
          if (typeFilter === 'purchases' && !m.movementType.startsWith('purchase')) return false;
        }

        // 3. Date range
        if (fromDate) {
          const movDate = m.createdAt.slice(0, 10);
          if (movDate < fromDate) return false;
        }
        if (toDate) {
          const movDate = m.createdAt.slice(0, 10);
          if (movDate > toDate) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [movements, searchQuery, typeFilter, fromDate, toDate, sortOrder]);

  // Summary statistics
  const stats = useMemo(() => {
    let inboundTotal = 0;
    let outboundTotal = 0;
    let wasteTotal = 0;

    for (const m of filteredMovements) {
      if (m.isInbound) {
        inboundTotal += m.quantity;
      } else {
        outboundTotal += m.quantity;
        if (m.movementType.includes('waste') || m.reason?.toLowerCase().includes('rotura') || m.reason?.toLowerCase().includes('merma')) {
          wasteTotal += m.quantity;
        }
      }
    }

    return {
      totalCount: filteredMovements.length,
      inboundTotal,
      outboundTotal,
      wasteTotal,
    };
  }, [filteredMovements]);

  // CSV Export handler
  const handleExportCSV = () => {
    if (filteredMovements.length === 0) {
      addSystemNotification('Kardex Vacío', 'No hay movimientos para exportar con los filtros seleccionados.', 'warning');
      return;
    }

    const exportItems: KardexExportItem[] = filteredMovements.map((m) => {
      const badge = getMovementBadgeInfo(m);
      return {
        id: m.id,
        createdAt: m.createdAt,
        productName: m.productName,
        productCode: m.productCode,
        movementType: m.movementType,
        movementTypeLabel: badge.label,
        quantity: m.delta,
        unit: m.productUnit,
        balance: m.balance,
        reason: m.reason || m.notes,
        operatorName: m.operatorName,
      };
    });

    exportKardexToCSV(exportItems);
    addSystemNotification('Kardex Exportado', `Se descargaron ${exportItems.length} registros del historial de movimientos.`, 'success');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Top Controls & Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase text-gray-500 tracking-wider">Movimientos</span>
            <div className="p-1.5 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
              <History className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900 dark:text-zinc-100 mt-2 font-mono">
            {stats.totalCount}
          </p>
          <span className="text-[10px] text-gray-400">Total en el período filtrado</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-emerald-100/40 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase text-emerald-600 tracking-wider">Ingresos Totales</span>
            <div className="p-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2 font-mono">
            +{stats.inboundTotal.toFixed(1)} <span className="text-xs font-sans text-gray-400 font-normal">u.</span>
          </p>
          <span className="text-[10px] text-gray-400">Producción, compras y ajustes (+)</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-rose-100/40 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase text-rose-600 tracking-wider">Egresos / Salidas</span>
            <div className="p-1.5 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2 font-mono">
            -{stats.outboundTotal.toFixed(1)} <span className="text-xs font-sans text-gray-400 font-normal">u.</span>
          </p>
          <span className="text-[10px] text-gray-400">Ventas, mermas y ajustes (-)</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-red-100/40 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase text-red-600 tracking-wider">Mermas / Desechos</span>
            <div className="p-1.5 rounded-xl bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-2 font-mono">
            {stats.wasteTotal.toFixed(1)} <span className="text-xs font-sans text-gray-400 font-normal">u.</span>
          </p>
          <span className="text-[10px] text-gray-400">Caducidad, roturas y desechos</span>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              id="input-kardex-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por producto, código, motivo o responsable..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl text-xs font-medium focus:ring-1 focus:ring-amber-500 outline-none text-gray-800 dark:text-zinc-100"
            />
          </div>

          {/* Quick Type Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 select-none">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'sales', label: 'Ventas' },
              { id: 'production', label: 'Producción' },
              { id: 'waste', label: 'Mermas' },
              { id: 'adjustments', label: 'Ajustes' },
              { id: 'purchases', label: 'Compras' },
            ].map((t) => (
              <button
                key={t.id}
                id={`btn-kardex-type-${t.id}`}
                onClick={() => setTypeFilter(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                  typeFilter === t.id
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Actions: Refresh & Export CSV */}
          <div className="flex items-center gap-2">
            <button
              id="btn-kardex-refresh"
              onClick={fetchMovements}
              disabled={loading}
              title="Recargar movimientos"
              className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 cursor-pointer transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              id="btn-kardex-export-csv"
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-extrabold cursor-pointer transition-all shadow-xs"
            >
              <Download className="h-4 w-4" />
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* Date Filter & Sort Toggle */}
        <div className="pt-2 border-t border-gray-100 dark:border-zinc-850 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-gray-500">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            <span className="font-bold text-[11px] uppercase tracking-wider">Rango de Fechas:</span>
            <input
              id="input-kardex-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-zinc-300 font-mono outline-none"
            />
            <span>hasta</span>
            <input
              id="input-kardex-to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-zinc-300 font-mono outline-none"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="text-[11px] text-amber-600 dark:text-amber-400 underline font-semibold cursor-pointer ml-1"
              >
                Limpiar fechas
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-kardex-sort-toggle"
              onClick={() => setSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'))}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-zinc-850 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 text-[11px] font-bold cursor-pointer transition-all"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span>{sortOrder === 'desc' ? 'Más recientes primero' : 'Más antiguos primero'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Kardex Table */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50/70 dark:bg-zinc-950 text-[10px] uppercase font-bold text-gray-400 select-none">
              <tr className="border-b border-gray-100 dark:border-zinc-850">
                <th className="py-3 px-3">Fecha y Hora</th>
                <th className="py-3 px-3">Producto / Insumo</th>
                <th className="py-3 px-3">Tipo de Movimiento</th>
                <th className="py-3 px-3 text-right">Variación</th>
                <th className="py-3 px-3 text-right">Balance Stock</th>
                <th className="py-3 px-3">Motivo / Detalle / Ref.</th>
                <th className="py-3 px-3">Responsable</th>
                <th className="py-3 px-3 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
              {loading && movements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-amber-500" />
                      <span className="font-bold">Cargando libro diario de stock...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-14 text-zinc-400 font-bold">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <History className="h-8 w-8 text-gray-300 dark:text-zinc-700" />
                      <p className="text-sm">No se encontraron movimientos registrados con los filtros actuales.</p>
                      <p className="text-[11px] text-gray-400 font-normal">
                        Los ingresos de producción, ventas y mermas se registrarán automáticamente aquí.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMovements.map((mov) => {
                  const badge = getMovementBadgeInfo(mov);
                  const formattedDate = new Date(mov.createdAt).toLocaleString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr
                      key={mov.id}
                      id={`kardex-row-${mov.id}`}
                      className="hover:bg-gray-50/60 dark:hover:bg-zinc-850/30 transition-colors"
                    >
                      {/* Fecha y hora */}
                      <td className="py-3.5 px-3 font-mono text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        {formattedDate}
                      </td>

                      {/* Producto */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base" role="img" aria-label={mov.productName}>
                            {mov.productImage}
                          </span>
                          <div>
                            <p className="font-extrabold text-gray-850 dark:text-zinc-100 leading-tight">
                              {mov.productName}
                            </p>
                            {mov.productCode && (
                              <span className="text-[10px] text-gray-400 font-mono">
                                Código: {mov.productCode}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Tipo de movimiento */}
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-black border uppercase tracking-wider ${badge.badgeClass}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* Cantidad variada */}
                      <td className="py-3.5 px-3 text-right">
                        <span className={`font-mono text-xs ${badge.qtyClass}`}>
                          {badge.sign}
                          {mov.quantity}&nbsp;
                          <span className="text-[10px] font-sans font-medium text-gray-400">
                            {mov.productUnit}
                          </span>
                        </span>
                      </td>

                      {/* Balance Stock */}
                      <td className="py-3.5 px-3 text-right font-mono text-xs">
                        {mov.balance !== undefined ? (
                          <span className="font-extrabold text-gray-750 dark:text-zinc-200">
                            {mov.balance}&nbsp;
                            <span className="text-[10px] font-sans font-normal text-gray-400">
                              {mov.productUnit}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-zinc-600">—</span>
                        )}
                      </td>

                      {/* Motivo / Detalle / Referencia */}
                      <td className="py-3.5 px-3 text-xs text-gray-600 dark:text-zinc-300">
                        <div className="max-w-xs truncate">
                          <span className="font-medium">{mov.reason || mov.notes || '—'}</span>
                          {mov.referenceId && (
                            <span className="text-[10px] text-gray-400 font-mono block">
                              Ref: {mov.referenceType ? `${mov.referenceType} #` : '#'}{mov.referenceId}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Responsable */}
                      <td className="py-3.5 px-3 text-xs text-gray-600 dark:text-zinc-400">
                        <span className="font-medium">{mov.operatorName || 'Operador'}</span>
                      </td>

                      {/* Estado: Nube vs Offline */}
                      <td className="py-3.5 px-3 text-center">
                        {mov.isOfflinePending ? (
                          <span
                            title="Pendiente de sincronizar con D1 (guardado offline)"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <Clock className="h-3 w-3" />
                            Offline
                          </span>
                        ) : (
                          <span
                            title="Sincronizado en la nube D1"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            <Cloud className="h-3 w-3" />
                            D1
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
