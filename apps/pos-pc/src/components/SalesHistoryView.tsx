import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { exportSalesToCSV, printTicketOrInvoice } from '../utils/exportUtils';
import {
  Download,
  Search,
  RotateCcw,
  Receipt,
  FileDown,
  Printer,
  ChevronDown,
  CircleAlert,
  Calendar,
  X,
  CreditCard,
  User,
  Trash2
} from 'lucide-react';
import { Sale } from '../types';

export const SalesHistoryView: React.FC = () => {
  const {
    sales,
    addSystemNotification,
    setSales,
    products,
    updateProductStock,
    ingredients,
    updateIngredientStock
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<'todos' | Sale['paymentMethod']>('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | Sale['paymentStatus']>('todos');
  
  // Dialog to view ticket detail
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  // Void/Cancel Sale (gently restores stock!)
  const handleVoidSale = (sale: Sale) => {
    if (!window.confirm(`¿Estás seguro de que deseas anular la factura ${sale.invoiceNumber}? El importe de $${sale.total.toFixed(2)} será revertido y los productos reingresarán al stock.`)) {
      return;
    }

    // Restore products stock
    sale.items.forEach(item => {
      const dbProd = products.find(p => p.id === item.productId);
      if (dbProd) {
        updateProductStock(dbProd.id, dbProd.stock + item.quantity);
        
        // Restore ingredients stock consumed in recipies
        dbProd.ingredients.forEach(recipeIng => {
          const dbIng = ingredients.find(i => i.id === recipeIng.ingredientId);
          if (dbIng) {
            const restoredWeight = recipeIng.quantity * item.quantity;
            updateIngredientStock(dbIng.id, dbIng.stock + restoredWeight);
          }
        });
      }
    });

    // Remove sale or change status to voided/failed
    setSales(prev =>
      prev.map(s => (s.id === sale.id ? { ...s, paymentStatus: 'failed' as const, invoiceNumber: `VOID-${s.invoiceNumber.slice(5)}` } : s))
    );

    addSystemNotification(
      '💸 Factura Anulada',
      `Factura ${sale.invoiceNumber} anulada. Mercadería e insumos reingresados a inventario.`,
      'warning'
    );
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
  });

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
          onChange={(e) => setMethodFilter(e.target.value as any)}
          className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-805 rounded-xl p-3 focus:outline-none text-gray-700 dark:text-zinc-350"
        >
          <option value="todos">💳 Todos los Métodos de Pago</option>
          <option value="efectivo">💵 Efectivo (Local)</option>
          <option value="tarjeta">💳 Tarjeta (Stripe)</option>
          <option value="mercado_pago">🤝 Mercado Pago</option>
          <option value="paypal">🌐 PayPal Checkout</option>
        </select>

        {/* Status filter */}
        <select
          id="filter-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
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
            <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none border-b border-gray-100 dark:border-zinc-855">
              <tr>
                <th className="py-4 px-5">Comp. Factura</th>
                <th className="py-4 px-5">Fecha / Arqueo</th>
                <th className="py-4 px-5">Operador Cajero</th>
                <th className="py-4 px-5">Cliente Comprador</th>
                <th className="py-4 px-5">Detalle Artículos</th>
                <th className="py-4 px-5 text-center">Medio de Cobro</th>
                <th className="py-4 px-5 text-right">Monto Total</th>
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
                filteredSales.map(sale => {
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
                        <span className="inline-flex items-center gap-1 bg-gray-50 dark:bg-zinc-950/40 border border-gray-100 dark:border-zinc-800 text-[10px] font-bold px-2 py-1 rounded-lg text-gray-700 dark:text-zinc-350">
                          {sale.paymentMethod === 'efectivo' ? '💵' : sale.paymentMethod === 'tarjeta' ? '💳' : sale.paymentMethod === 'mercado_pago' ? '🤝' : '🌐'}{' '}
                          {sale.paymentMethod.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>

                      {/* Total */}
                      <td className="py-4 px-5 text-right font-mono font-extrabold text-sm text-gray-900 dark:text-zinc-50 font-sans">
                        ${sale.total.toFixed(2)}
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
                          
                          {isSuccess && !isVoided && (
                            // Only can void success billing records in PC admin session
                            <button
                              id={`btn-void-invoice-${sale.id}`}
                              onClick={() => handleVoidSale(sale)}
                              className="p-1.5 rounded-lg border border-red-250 dark:border-red-900/40 bg-red-50/10 hover:bg-red-500 hover:text-white text-red-500 dark:text-red-400 cursor-pointer transition-colors"
                              title="Anular venta y reingresar stock de productos e ingredientes"
                            >
                              <X className="h-4 w-4" />
                            </button>
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
                <p className="font-extrabold text-sm text-amber-600 dark:text-amber-500">🌾 TRIGO DE ORO 🌾</p>
                <p className="text-[10px] text-gray-400">Av. San Martín 1542, CABA</p>
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
                      <td className="text-right py-1.5">${(item.price * item.quantity).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="border-b border-dashed border-gray-300 dark:border-zinc-800 my-3" />

              <div className="space-y-1 font-sans font-medium text-gray-600 dark:text-zinc-400">
                <div className="flex justify-between">
                  <span>Neto Neto:</span>
                  <span>${(selectedSale.total * 0.79).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>IVA Tasa Gral (21%):</span>
                  <span>${selectedSale.tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-base font-extrabold text-gray-850 dark:text-zinc-50 border-t pt-1.5 border-amber-200">
                  <span>TOTAL COMPROBANTE:</span>
                  <span>${selectedSale.total.toFixed(2)}</span>
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

            {selectedSale.paymentStatus === 'completed' && (
              <button
                id="btn-void-secondary-trigger"
                onClick={() => handleVoidSale(selectedSale)}
                className="w-full mt-3 py-2.5 bg-red-100 hover:bg-red-500 hover:text-white border border-red-200 dark:border-red-950/20 text-red-650 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" /> Anular Factura y Devolver Stock
              </button>
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
