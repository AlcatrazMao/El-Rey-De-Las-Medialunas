import {
  LayoutDashboard,
  Settings2,
  AlertTriangle,
  Check
} from 'lucide-react';
import * as React from 'react'
import { useState } from 'react';

import { useApp } from '../AppContext';
import { resolveFallbackBranchId } from '../hooks/useSettings';

import { AccountingWidget } from './dashboard/AccountingWidget';
import { InventoryWidget } from './dashboard/InventoryWidget';
import { PresentationsWidget } from './dashboard/PresentationsWidget';
import { RecentSalesTable } from './dashboard/RecentSalesTable';
import { SalesSummaryCard } from './dashboard/SalesSummaryCard';
import { StockAlertList } from './dashboard/StockAlertList';
import { TransferRecommendationsBanner } from './dashboard/TransferRecommendationsBanner';

export const Dashboard: React.FC = () => {
  const {
    sales,
    expenses,
    ingredients,
    products,
    activeUser,
    updateUserWidgets,
    batches = [],
    addSystemNotification,
    activeBranchId,
    setActiveTab,
  } = useApp();

  // Multi-branch transfers (fase 3): roles elevados ven además un atajo al
  // panel de traslados agregado (mismo TransfersView, sin duplicar UI).
  const role = (activeUser?.role ?? '') as string;
  const isElevated = role === 'admin' || role === 'owner' || role === 'supervisor';
  // activeBranchId es la fuente de verdad (AppContext); si todavía no se
  // resolvió (carrera con el login, o backend viejo sin branches[]), caemos
  // al branchId de settings SOLO como fallback — ver useSettings.ts.
  const effectiveBranchId = activeBranchId ?? resolveFallbackBranchId();

  // FIX A3: lotes activos que vencen en las próximas 24h — alerta crítica
  // para que el admin retire/promocione antes de que el cron los expire.
  const expiringBatches = React.useMemo(() => {
    const now = Date.now();
    const cutoff = now + 24 * 60 * 60 * 1000;
    return batches
      .filter(b => {
        if (b.status !== 'active') return false;
        if (!b.expiryDate) return false;
        const t = new Date(b.expiryDate).getTime();
        return Number.isFinite(t) && t >= now && t <= cutoff;
      })
      .map(b => ({
        ...b,
        productName: products.find(p => p.id === b.productId)?.name ?? b.productId,
      }))
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [batches, products]);

  // Control customization modal visibility
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Available dashboards list configuration
  const ALL_WIDGET_OPTIONS = [
    { id: 'widget_facturacion', label: 'Resumen Rápido Finanzas', desc: 'Tarjetas bento con ingresos, egresos y neto calculado.' },
    { id: 'widget_contabilidad', label: 'Gráfico Analítico Mensual', desc: 'Histograma interactivo de facturación versus egresos.' },
    { id: 'widget_inventario', label: 'Seguimiento de Materia Prima', desc: 'Nivel crítico de existencias principales (Harina, Levadura, etc.).' },
    { id: 'widget_alertas', label: 'Monitor de Notificaciones y Alertas', desc: 'Registro de alertas activas o transacciones fallidas.' },
    { id: 'widget_historico', label: 'Últimos Comprobantes de Caja', desc: 'Historial express de las últimas 4 ventas concretadas.' },
    { id: 'widget_presentaciones', label: 'Desglose por Presentación', desc: 'Ventas por presentación (Unidad, Docena, etc.) por artículo.' }
  ];

  // Toggle widget membership
  const handleWidgetToggle = (widgetId: string) => {
    const isPresent = activeUser.customPanels.includes(widgetId);
    let updated: string[];
    if (isPresent) {
      // Don't let users empty all widgets so they don't see a blank screen
      if (activeUser.customPanels.length <= 1) {
        addSystemNotification('⚠️ Tablero mínimo', 'Debes dejar al menos una sección activa para visualizar el tablero.', 'warning');
        return;
      }
      updated = activeUser.customPanels.filter(id => id !== widgetId);
    } else {
      updated = [...activeUser.customPanels, widgetId];
    }
    updateUserWidgets(updated);
  };

  // Reorder shift down/up simulation
  const shiftWidgetOrderDetail = (widgetId: string, direction: 'up' | 'down') => {
    const idx = activeUser.customPanels.indexOf(widgetId);
    if (idx === -1) return;
    const items = [...activeUser.customPanels];
    
    if (direction === 'up' && idx > 0) {
      const temp = items[idx - 1];
      items[idx - 1] = items[idx];
      items[idx] = temp;
    } else if (direction === 'down' && idx < items.length - 1) {
      const temp = items[idx + 1];
      items[idx + 1] = items[idx];
      items[idx] = temp;
    }
    updateUserWidgets(items);
  };

  // 1. Math formulas for dashboard calculations
  const successfulSales = sales.filter(s => s.paymentStatus === 'completed');
  const totalRevenue = successfulSales.reduce((acc, s) => acc + s.total, 0);
  const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
  const totalInsumosSobrantesValue = ingredients.reduce((sum, ing) => sum + (ing.stock * ing.unitCost), 0);
  {/* RENDER INDIVIDUAL WIDGET: FINANCIAL SUMMARY BENTO DECORATORS */}
  const renderWidgetFacturacion = () => (
    <SalesSummaryCard
      totalRevenue={totalRevenue}
      totalExpenses={totalExpenses}
      totalInsumosSobrantesValue={totalInsumosSobrantesValue}
    />
  );

  {/* RENDER INDIVIDUAL WIDGET: ANALYTICAL INTERACTIVE HISTOGRAM */}
  const renderWidgetContabilidad = () => (
    <AccountingWidget products={products} successfulSales={successfulSales} />
  );

  {/* RENDER INDIVIDUAL WIDGET: RAW MATERIALS STOCK STATUS TRACKER */}
  const renderWidgetInventario = () => (
    <InventoryWidget ingredients={ingredients} />
  );

  {/* RENDER INDIVIDUAL WIDGET: CRITICAL NOTIFICATIONS LOGS LIST */}
  const renderWidgetAlertas = () => (
    <StockAlertList ingredients={ingredients} sales={sales} />
  );

  {/* RENDER INDIVIDUAL WIDGET: RECENT TELLER COMPROBANTES EXP LOG */}
  const renderWidgetHistorico = () => (
    <RecentSalesTable successfulSales={successfulSales} />
  );

  // ── Desglose por presentación ──────────────────────────────────────────
  // T5.2: si no hay ventas con presentation, el widget devuelve null.
  // Lógica extraída a `PresentationsWidget` para reducir el tamaño de Dashboard.
  const renderWidgetPresentaciones = () => (
    <PresentationsWidget products={products} successfulSales={successfulSales} />
  );

  // Map of keys to actual renderer components.
  // ReactNode (no JSX.Element) — `PresentationsWidget` puede devolver `null`
  // cuando no hay ventas con presentación (regla T5.2).
  const widgetMapping: Record<string, () => React.ReactNode> = {
    widget_facturacion: renderWidgetFacturacion,
    widget_contabilidad: renderWidgetContabilidad,
    widget_inventario: renderWidgetInventario,
    widget_alertas: renderWidgetAlertas,
    widget_historico: renderWidgetHistorico,
    widget_presentaciones: renderWidgetPresentaciones
  };

  return (
    <div className="space-y-6 transition-all duration-300">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between border-b pb-4 border-gray-100 dark:border-zinc-800 select-none">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-amber-500" /> Tablero de Inteligencia de Negocio
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Analíticas consolidadas de producción, arqueo y ventas sincronizadas en la nube.
          </p>
        </div>

        {/* Customization launcher — admin only */}
        {activeUser.role === 'admin' && (
        <button
          id="btn-customize-dashboard"
          onClick={() => setShowConfigModal(true)}
          className="py-2.5 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-600 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 text-xs font-bold flex items-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer"
        >
          <Settings2 className="h-4.5 w-4.5 text-amber-500" /> Personalizar mi Panel
        </button>
        )}
      </div>

      {/* FIX A3: lotes vencen en próximas 24h — alerta visible siempre */}
      {expiringBatches.length > 0 && (
        <div
          id="dashboard-expiring-batches-alert"
          className="bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-900/50 rounded-2xl p-4 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            <h3 className="font-extrabold text-sm text-red-800 dark:text-red-300">
              ⏰ {expiringBatches.length} lote{expiringBatches.length === 1 ? '' : 's'} vence{expiringBatches.length === 1 ? '' : 'n'} en menos de 24 horas
            </h3>
          </div>
          <p className="text-[10px] text-red-700/80 dark:text-red-400/80 font-semibold mb-2">
            Revisá lotes activos para retirar, descontar o promocionar antes del vencimiento automático.
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {expiringBatches.slice(0, 10).map(b => (
              <li
                key={b.id}
                className="flex items-center justify-between text-[11px] bg-white dark:bg-zinc-950/40 rounded-lg px-2 py-1 border border-red-100 dark:border-red-900/30"
              >
                <span className="font-bold text-gray-800 dark:text-zinc-200 truncate">
                  {b.productName} — Lote {b.batchNumber}
                </span>
                <span className="font-mono text-red-700 dark:text-red-300 shrink-0 ml-2">
                  {b.stock}u • vence {new Date(b.expiryDate).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Multi-branch transfers (fase 3): recomendaciones de traslado + atajo
          al panel agregado para roles elevados. Se degrada a null si no hay
          activeBranchId resuelto o no hay sugerencias — no ocupa espacio. */}
      <TransferRecommendationsBanner branchId={effectiveBranchId} />
      {isElevated && (
        <button
          onClick={() => setActiveTab('transfers')}
          className="w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 rounded-2xl border border-cyan-200 dark:border-cyan-900/40 bg-cyan-50/50 dark:bg-cyan-950/10 text-cyan-800 dark:text-cyan-300 text-xs font-bold hover:bg-cyan-100/60 dark:hover:bg-cyan-950/20 transition-colors"
        >
          Ver traslados entre todas las sucursales
          <span aria-hidden>→</span>
        </button>
      )}

      {/* DYNAMIC WIDGETS DISPLAY (based on user custom preferred array!) */}
      <div className="space-y-6">
        {activeUser.customPanels.map((widgetId, idx) => {
          const renderer = widgetMapping[widgetId];
          if (!renderer) return null;
          const isFirst = idx === 0;
          const isLast = idx === activeUser.customPanels.length - 1;

          return (
            <div key={widgetId} className="relative group">
              {/* Controls hovering overlay */}
              <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 flex gap-1 bg-white dark:bg-zinc-900 border border-gray-150 p-1.5 rounded-lg shadow-sm transition-opacity z-10 select-none">
                <button
                  id={`btn-widget-up-${widgetId}`}
                  onClick={() => shiftWidgetOrderDetail(widgetId, 'up')}
                  disabled={isFirst}
                  className={`text-xs font-bold text-gray-500 hover:text-amber-500 p-1 shrink-0 ${isFirst ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title="Subir posición"
                >
                  ▲
                </button>
                <button
                  id={`btn-widget-down-${widgetId}`}
                  onClick={() => shiftWidgetOrderDetail(widgetId, 'down')}
                  disabled={isLast}
                  className={`text-xs font-bold text-gray-500 hover:text-amber-500 p-1 shrink-0 ${isLast ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title="Bajar posición"
                >
                  ▼
                </button>
                <button
                  id={`btn-widget-hide-${widgetId}`}
                  onClick={() => handleWidgetToggle(widgetId)}
                  className="text-xs font-bold text-gray-450 hover:text-red-500 p-1 cursor-pointer shrink-0"
                  title="Ocultar de mi tablero personal"
                >
                  ✕
                </button>
              </div>

              {/* Render content */}
              {renderer()}
            </div>
          );
        })}
      </div>

      {/* CUSTOMIZATION DRAWER CONFIGURATION MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in dialog-overlay">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-2.5 border-gray-100 dark:border-zinc-800 select-none">
              <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50 flex items-center gap-1.5">
                <Settings2 className="h-4.5 w-4.5 text-amber-500" /> Configurar Tablero de Analíticas
              </h3>
              <button
                id="btn-config-modal-close"
                onClick={() => setShowConfigModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed font-semibold">
              Seleccione las secciones que desea ver activas en su pantalla de inicio. Cada operador (Dueño, Cajera, Panadera) conserva su distribución predilecta.
            </p>

            <div className="space-y-2 select-none">
              {ALL_WIDGET_OPTIONS.map(opt => {
                const isActive = activeUser.customPanels.includes(opt.id);

                return (
                  <button
                    key={opt.id}
                    id={`btn-toggle-widget-choice-${opt.id}`}
                    type="button"
                    onClick={() => handleWidgetToggle(opt.id)}
                    className={`w-full p-3 rounded-2xl text-left border flex items-center justify-between transition-all cursor-pointer ${
                      isActive
                        ? 'bg-amber-50/70 border-amber-300 dark:bg-amber-950/20 dark:border-amber-900 text-amber-900 dark:text-amber-400 font-bold'
                        : 'bg-white dark:bg-zinc-850 border-gray-100 dark:border-zinc-805 hover:bg-gray-55 text-gray-700 dark:text-zinc-300'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-black">{opt.label}</p>
                      <p className="text-[10px] text-gray-450 dark:text-zinc-500 leading-tight font-medium mt-0.5">{opt.desc}</p>
                    </div>

                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${isActive ? 'bg-amber-500 border-transparent text-white' : 'border-gray-300'}`}>
                      {isActive && <Check className="h-3 w-3" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-gray-155 select-none">
              <button
                id="btn-config-modal-confirm"
                onClick={() => setShowConfigModal(false)}
                className="w-full py-3 bg-zinc-900 dark:bg-zinc-200 dark:text-zinc-950 text-white rounded-2xl text-xs font-bold hover:opacity-90 cursor-pointer text-center"
              >
                Listo, Guardar Distribución
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
