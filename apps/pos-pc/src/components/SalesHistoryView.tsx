import {
  Download,
  Search,
  Receipt,
  FileDown,
  Printer,
  Calendar,
  X,
  Trash2
} from 'lucide-react';
import * as React from 'react'
import { useState, useEffect } from 'react';

import { useApp } from '../AppContext';
import { getSettings } from '../hooks/useSettings';
import { syncVoidSaleToD1 } from '../services/d1-sync';
import type { Sale } from '../types';
import { exportSalesToCSV, printTicketOrInvoice } from '../utils/exportUtils';
import { formatCurrency } from '../utils/format';

export const SalesHistoryView: React.FC = () => {
  const {
    sales,
    addSystemNotification,
    setSales,
    products,
    updateProductStock,
    ingredients,
    updateIngredientStock,
    setBatches
  } = useApp();

  const PAGE_SIZE = 30;

  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<'todos' | Sale['paymentMethod']>('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | Sale['paymentStatus']>('todos');
  const [sortCol, setSortCol] = useState<'date' | 'total' | 'invoice'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Dialog to view ticket detail
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  // Inline confirmation state for void action
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);

  // Void/Cancel Sale (gently restores stock!)
  const handleVoidSale = (sale: Sale) => {
    // Restore products stock & ingredients in one pass
    sale.items.forEach(item => {
      const dbProd = products.find(p => p.id === item.productId);
      if (dbProd) {
        updateProductStock(dbProd.id, dbProd.stock + item.quantity);
        dbProd.ingredients.forEach(recipeIng => {
          const dbIng = ingredients.find(i => i.id === recipeIng.ingredientId);
          if (dbIng) updateIngredientStock(dbIng.id, dbIng.stock + recipeIng.quantity * item.quantity);
        });
      }
    });

    // Restore batch stock in a single setBatches call (reverse-FIFO, no over-restore)
    setBatches(prev => {
      const updated = [...prev];
      for (const item of sale.items) {
        let toRestore = item.quantity;
        // Newest-expiry first = reverse of the FIFO order used at sale time
        const eligible = updated
          .map((b, idx) => ({ b, idx }))
          .filter(({ b }) => b.productId === item.productId && b.quantity > b.stock)
          .sort((a, z) => new Date(z.b.expiryDate).getTime() - new Date(a.b.expiryDate).getTime());
        for (const { b, idx } of eligible) {
          if (toRestore <= 0) break;
          const canRestore = Math.min(toRestore, b.quantity - b.stock);
          toRestore -= canRestore;
          updated[idx] = { ...b, stock: b.stock + canRestore, status: 'active' as const };
        }
      }
      return updated;
    });

    // Remove sale or change status to voided/failed
    setSales(prev =>
      prev.map(s => (s.id === sale.id ? { ...s, paymentStatus: 'voided' as const, invoiceNumber: `VOID-${s.invoiceNumber.slice(5)}` } : s))
    );

    syncVoidSaleToD1(sale.id, 'Anulación manual desde historial de ventas').catch(() => {});

    addSystemNotification(
      '💸 Factura Anulada',
      `Factura ${sale.invoiceNumber} anulada. Mercadería e insumos reingresados a inventario.`,
      'warning'
    );
    setConfirmVoidId(null);
    setSelectedSale(null);
  };

  // Filter computations
  const filteredSales = sales.filter(sale => {
    const matchesSearch = (sale.customerName || 'Consumidor Final').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          sale.invoiceNumber.includes(searchQuery) ||
                          sale.operatorName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMethod = methodFilter === 'todos' || sale.paymentMethod === methodFilter;
    const matchesStatus = statusFilter === 'todos' || sale.paymentStatus === statusFilter;
    return matchesSearch && matchesMethod && matchesStatus;
  }).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortCol === 'date') return dir * (new Date(a.date).getTime() - new Date(b.date).getTime());
    if (sortCol === 'total') return dir * (b.total - a.total);
    return dir * a.invoiceNumber.localeCompare(b.invoiceNumber);
  });

  // Pagination
  useEffect(() => { setCurrentPage(1); }, [filteredSales.length]);
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const paginatedSales = filteredSales.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = filteredSales.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredSales.length);

  return (
    <div className="space-y-6 transition-all duration-300">
      
      {/* SECTION HEADER */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between border-b pb-4 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-amber-500" /> Historial de Facturación y Ventas Digitales
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Control fiscal de arqueo de caja diario, facturas electrónicas emitidas y cobros por pasarela.
          </p>
        </div>

        <button
          id="btn-export-sales"
          onClick={() => exportSalesToCSV(sales)}
          className="py-2.5 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
        >
          <Download className="h-4 w-4" /> Exportar Informe de Ventas (CSV)
        </button>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-4 rounded-2xl shadow-xs">
        {/* Search */}
        <div className="relative">
          <input
            id="history-search"
            type="text"
            placeholder="Buscar por cliente, factura o caja..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-805 rounded-xl py-3 pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-805 dark:text-zinc-100 font-semibold"
          />
          <Search className="absolute left-2.5 top-3.5 h-3.5 w-3.5 text-gray-400" />
        </div>

        {/* Method filter */}
        <select
          id="filter-method"
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value as Sale['paymentMethod'])}
          className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-805 rounded-xl p-3 focus:outline-none text-gray-700 dark:text-zinc-350"
        >
          <option value="todos">💳 Todos los Métodos de Pago</option>
          <option value="tarjeta">💳 Tarjeta</option>
          <option value="transferencia">🏦 Transferencia</option>
        </select>

        {/* Status filter */}
        <select
          id="filter-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as Sale['paymentStatus'])}
          className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-805 rounded-xl p-3 focus:outline-none text-gray-700 dark:text-zinc-350"
        >
          <option value="todos">📂 Todos los Estados</option>
          <option value="completed">✅ Cobrada por Pasarela</option>
          <option value="failed">❌ Rechazada / Anulada (Alerta)</option>
          <option value="pending">🕒 En Espera de Firma / Autorizando</option>
        </select>
      </div>

      {/* INVOICES TABLE REGISTER */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none border-b border-gray-100 dark:border-zinc-800">
              <tr>
                <th className="py-4 px-5 cursor-pointer hover:text-amber-600 transition-colors" onClick={() => { setSortCol('invoice'); setSortDir(sortCol === 'invoice' ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'); setCurrentPage(1); }}>
                  Factura {sortCol === 'invoice' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th className="py-4 px-5 cursor-pointer hover:text-amber-600 transition-colors" onClick={() => { setSortCol('date'); setSortDir(sortCol === 'date' ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'); setCurrentPage(1); }}>
                  Fecha {sortCol === 'date' ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
                </th>
                <th className="py-4 px-5">Operador</th>
                <th className="py-4 px-5">Cliente</th>
                <th className="py-4 px-5">Artículos</th>
                <th className="py-4 px-5 text-center">Pago</th>
                <th className="py-4 px-5 text-right cursor-pointer hover:text-amber-600 transition-colors" onClick={() => { setSortCol('total'); setSortDir(sortCol === 'total' ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'); setCurrentPage(1); }}>
                  Total {sortCol === 'total' ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
                </th>
                <th className="py-4 px-5 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-805/60 font-semibold text-gray-800 dark:text-zinc-200">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-gray-400">
                    <Receipt className="h-10 w-10 mx-auto opacity-20 mb-2" />
                    <p className="font-bold">No se registran comprobantes de facturación coincidentes</p>
                    <p className="text-[11px] text-gray-400 mt-1">Modifica los filtros de búsqueda superior</p>
                  </td>
                </tr>
              ) : (
                paginatedSales.map(sale => {
                  const isSuccess = sale.paymentStatus === 'completed';
                  const isVoided = sale.invoiceNumber.startsWith('VOID-');

                  return (
                    <tr
                      key={sale.id}
                      className={`hover:bg-gray-50/50 dark:hover:bg-zinc-850/30 ${
                        isVoided 
                          ? 'bg-red-50/5 text-gray-400 dark:text-zinc-600 line-through' 
                          : !isSuccess 
                          ? 'bg-red-50/20 dark:bg-red-950/5 text-red-700 dark:text-red-300' 
                          : ''
                      }`}
                    >
                      {/* Comp Number */}
                      <td className="py-4 px-5 font-mono font-extrabold text-amber-600 dark:text-amber-500">
                        {sale.invoiceNumber}
                      </td>

                      {/* Date */}
                      <td className="py-4 px-5 text-gray-500 dark:text-zinc-400 font-medium">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Calendar className="h-3 w-3 opacity-60" />
                          {new Date(sale.date).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </td>

                      {/* Cashier operator */}
                      <td className="py-4 px-5 text-gray-600 dark:text-zinc-300">
                        {sale.operatorName}
                      </td>

                      {/* Customer Name */}
                      <td className="py-4 px-5">
                        <div className="flex flex-col">
                          <span className="font-bold">{sale.customerName || 'Consumidor Final'}</span>
                          {sale.customerDoc && <span className="text-[9px] text-gray-400 font-mono italic">Doc: {sale.customerDoc}</span>}
                        </div>
                      </td>

                      {/* Items Summarized */}
                      <td className="py-4 px-5 text-gray-600 dark:text-zinc-400 font-medium max-w-[200px] truncate">
                        {sale.items.map(item => `${item.name} (x${item.quantity})`).join(', ')}
                      </td>

                      {/* Payment method */}
                      <td className="py-4 px-5 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1 bg-gray-50 dark:bg-zinc-950/40 border border-gray-100 dark:border-zinc-800 text-[10px] font-bold px-2 py-1 rounded-lg text-gray-700 dark:text-zinc-350">
                            {sale.paymentMethod === 'tarjeta' ? '💳' : '🏦'}{' '}
                            {sale.paymentMethod.replace('_', ' ').toUpperCase()}
                          </span>
                          {sale.syncFailed && (
                            <span
                              className="inline-flex items-center gap-0.5 bg-amber-100 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
                              title="Esta venta no pudo sincronizarse. Se reintentará automáticamente."
                            >
                              ⚠ Sin sync
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Total */}
                      <td className="py-4 px-5 text-right font-mono font-extrabold text-sm text-gray-900 dark:text-zinc-50 font-sans">
                        <div className="flex flex-col items-end gap-0.5">
                          {formatCurrency(sale.total)}
                          {sale.discountPercent && sale.discountPercent > 0 && (
                            <span
                              title={`Descuento aplicado: -${sale.discountPercent}% (- ${formatCurrency(sale.discountAmount ?? 0)})`}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-[9px] font-extrabold border border-emerald-200 dark:border-emerald-800/40"
                            >
                              🏷️ -{sale.discountPercent}%
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Invoice management row */}
                      <td className="py-4 px-5 text-center select-none">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            id={`btn-view-invoice-${sale.id}`}
                            onClick={() => setSelectedSale(sale)}
                            className="p-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-600 dark:text-zinc-350 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-amber-500 cursor-pointer"
                            title="Ver detalle del ticket comercial"
                          >
                            <Receipt className="h-4 w-4" />
                          </button>
                          
                          {isSuccess && !isVoided && confirmVoidId !== sale.id && (
                            // Only can void success billing records in PC admin session
                            <button
                              id={`btn-void-invoice-${sale.id}`}
                              onClick={() => setConfirmVoidId(sale.id)}
                              className="p-1.5 rounded-lg border border-red-250 dark:border-red-900/40 bg-red-50/10 hover:bg-red-500 hover:text-white text-red-500 dark:text-red-400 cursor-pointer transition-colors"
                              title="Anular venta y reingresar stock de productos e ingredientes"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                          {isSuccess && !isVoided && confirmVoidId === sale.id && (
                            <div className="flex items-center gap-1">
                              <button
                                id={`btn-confirm-void-${sale.id}`}
                                onClick={() => handleVoidSale(sale)}
                                className="px-2 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold cursor-pointer transition-colors"
                                title={`Confirmar anulación de ${sale.invoiceNumber}`}
                              >
                                Confirmar
                              </button>
                              <button
                                id={`btn-cancel-void-${sale.id}`}
                                onClick={() => setConfirmVoidId(null)}
                                className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-700 dark:text-zinc-200 hover:bg-gray-100 text-[10px] font-bold cursor-pointer transition-colors"
                                title="Cancelar anulación"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION FOOTER */}
        {filteredSales.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400">
              Mostrando {rangeStart}–{rangeEnd} de {filteredSales.length} ventas
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                ← Anterior
              </button>
              <span className="text-xs font-bold text-gray-600 dark:text-zinc-300 px-1 select-none">
                Página {currentPage} de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FLOATING DIALOG TICKET DETAIL */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in dialog-overlay">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-850 p-6 max-w-sm w-full flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b pb-3 border-gray-100 dark:border-zinc-800 mb-4">
              <h3 className="font-extrabold text-sm text-gray-800 dark:text-zinc-100 flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-amber-505" /> Comprobante {selectedSale.invoiceNumber}
              </h3>
              <button
                id="btn-close-ticket-detail"
                onClick={() => setSelectedSale(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Simulated scroll details paper style */}
            <div className="flex-1 overflow-y-auto max-h-[45vh] bg-amber-50/15 dark:bg-zinc-950/20 p-4 rounded-xl border border-dotted border-gray-300 dark:border-zinc-800 font-mono text-xs text-gray-800 dark:text-zinc-300">
              <div className="text-center">
                <p className="font-extrabold text-sm text-amber-600 dark:text-amber-500">🥐 {getSettings().business.businessName || 'El Rey De Las Medialunas'} 🥐</p>
                <p className="text-[10px] text-gray-400">Factura electrónica</p>
                <p className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-2" />
              </div>

              <div className="space-y-1">
                <p>Fecha: {new Date(selectedSale.date).toLocaleString('es-AR')}</p>
                <p>Caja: {selectedSale.operatorName}</p>
                <p>Comprador: {selectedSale.customerName || 'Consumidor Final'}</p>
                {selectedSale.customerDoc && <p>CUIT/DNI: {selectedSale.customerDoc}</p>}
                <p>Medio Pago: {selectedSale.paymentMethod.replace('_', ' ').toUpperCase()}</p>
                <p>Estado Operativo: <span className={selectedSale.paymentStatus === 'completed' ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                  {selectedSale.paymentStatus.toUpperCase()}
                </span></p>
              </div>

              <p className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-3" />

              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="border-b border-gray-300 dark:border-zinc-800">
                    <th className="pb-1 text-left">Detalle</th>
                    <th className="pb-1 text-right">Sub</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-850/40">
                  {selectedSale.items.map((item, id) => (
                    <tr key={id}>
                      <td className="py-1.5">{item.name} x{item.quantity}</td>
                      <td className="text-right py-1.5">{formatCurrency(item.price * item.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-3" />

              <div className="space-y-1 font-sans font-medium text-gray-600 dark:text-zinc-400">
                <div className="flex justify-between">
                  <span>Neto Gravado:</span>
                  <span>{formatCurrency(selectedSale.total - selectedSale.tax)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{`IVA Tasa Gral (${(getSettings().fiscal.ivaRate * 100).toFixed(0)}%):`}</span>
                  <span>{formatCurrency(selectedSale.tax)}</span>
                </div>
                {selectedSale.discountPercent && selectedSale.discountPercent > 0 && (
                  <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                    <span>Descuento ({selectedSale.discountPercent}%):</span>
                    <span>- {formatCurrency(selectedSale.discountAmount ?? 0)}</span>
                  </div>
                )}
                {selectedSale.surchargePercent && selectedSale.surchargePercent > 0 && (
                  <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400 font-bold">
                    <span>Recargo ({selectedSale.surchargePercent}%):</span>
                    <span>+ {formatCurrency(selectedSale.surchargeAmount ?? 0)}</span>
                  </div>
                )}
                {selectedSale.paymentAdjustmentType === 'recargo' && (selectedSale.paymentAdjustmentAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400 font-bold">
                    <span>Recargo método pago ({selectedSale.paymentAdjustmentPercent}%):</span>
                    <span>+ {formatCurrency(selectedSale.paymentAdjustmentAmount ?? 0)}</span>
                  </div>
                )}
                {selectedSale.paymentAdjustmentType === 'descuento' && (selectedSale.paymentAdjustmentAmount ?? 0) < 0 && (
                  <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                    <span>Descuento método pago ({selectedSale.paymentAdjustmentPercent}%):</span>
                    <span>- {formatCurrency(Math.abs(selectedSale.paymentAdjustmentAmount ?? 0))}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-extrabold text-gray-850 dark:text-zinc-50 border-t pt-1.5 border-amber-200">
                  <span>TOTAL COMPROBANTE:</span>
                  <span>{formatCurrency(selectedSale.total)}</span>
                </div>
              </div>
            </div>

            {/* Quick print trigger handles */}
            <div className="grid grid-cols-2 gap-2 mt-4 bg-gray-50 dark:bg-zinc-950 p-3 rounded-xl border border-gray-100 dark:border-zinc-850 select-none">
              <button
                id="btn-print-receipt-secondary"
                onClick={() => printTicketOrInvoice(selectedSale, 'receipt')}
                className="py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 hover:bg-gray-100 text-[11px] font-bold text-gray-700 dark:text-zinc-200 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" /> Reimp. Papel
              </button>
              <button
                id="btn-print-invoice-secondary"
                onClick={() => printTicketOrInvoice(selectedSale, 'invoice')}
                className="py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 hover:bg-gray-100 text-[11px] font-bold text-gray-700 dark:text-zinc-200 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <FileDown className="h-3.5 w-3.5" /> Factura PDF
              </button>
            </div>

            {selectedSale.paymentStatus === 'completed' && confirmVoidId !== selectedSale.id && (
              <button
                id="btn-void-secondary-trigger"
                onClick={() => setConfirmVoidId(selectedSale.id)}
                className="w-full mt-3 py-2.5 bg-red-100 hover:bg-red-500 hover:text-white border border-red-200 dark:border-red-950/20 text-red-650 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" /> Anular Factura y Devolver Stock
              </button>
            )}

            {selectedSale.paymentStatus === 'completed' && confirmVoidId === selectedSale.id && (
              <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40">
                <p className="text-[11px] font-bold text-red-700 dark:text-red-300 mb-2 text-center">
                  ¿Confirmás anular {selectedSale.invoiceNumber} por {formatCurrency(selectedSale.total)}? El stock será reingresado.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn-void-secondary-confirm"
                    onClick={() => handleVoidSale(selectedSale)}
                    className="py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[11px] font-bold cursor-pointer transition-colors flex items-center justify-center gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Confirmar anulación
                  </button>
                  <button
                    id="btn-void-secondary-cancel"
                    onClick={() => setConfirmVoidId(null)}
                    className="py-2 bg-white dark:bg-zinc-850 border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-200 hover:bg-gray-100 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <button
              id="btn-close-secondary-ticket"
              onClick={() => setSelectedSale(null)}
              className="w-full mt-3 py-2 bg-zinc-900 dark:bg-zinc-200 dark:text-zinc-955 text-white rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer"
            >
              Cerrar Vista
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
