import {
  HandCoins,
  TrendingUp,
  Plus,
  Search,
  Scale,
  DollarSign,
  Download,
  AlertCircle,
  X,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import * as React from 'react';
import { useState, useMemo } from 'react';

import { useApp } from '../AppContext';
import type { Expense } from '../types';
import {
  buildAccountingMovements,
  filterAccountingMovements,
  calculateAccountingTotals,
} from '../utils/accounting';
import { exportExpensesToCSV } from '../utils/exportUtils';
import { formatCurrency } from '../utils/format';

export const AccountingView: React.FC = () => {
  const {
    sales,
    expenses,
    addExpense,
    products,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<'todos' | 'ingreso' | 'egreso'>('todos');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');

  // Expense dialog controllers
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expConcept, setExpConcept] = useState('');
  const [expCategory, setExpCategory] = useState<Expense['category']>('materia_prima');
  const [expAmount, setExpAmount] = useState(100);
  const [expPaymentMethod, setExpPaymentMethod] = useState('Transferencia Bancaria');

  const handleExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expConcept.trim()) return;

    addExpense({
      concept: expConcept,
      category: expCategory,
      amount: Number(expAmount),
      paymentMethod: expPaymentMethod,
    });

    setExpConcept('');
    setExpCategory('materia_prima');
    setExpAmount(100);
    setExpPaymentMethod('Transferencia Bancaria');
    setShowExpenseModal(false);
  };

  // Financial calculations from completed bills
  const successfulSales = useMemo(
    () => sales.filter(s => s.paymentStatus === 'completed' && !s.invoiceNumber?.startsWith('VOID-')),
    [sales]
  );
  const totalRevenue = successfulSales.reduce((acc, s) => acc + s.total, 0);

  const totalCOGS = successfulSales.reduce((acc, s) => {
    let saleCOGS = 0;
    s.items.forEach(item => {
      // item.cost is the snapshot at sale time; fallback to current catalog if older data lacks it
      const costPerUnit = item.cost ?? products.find(p => p.id === item.productId)?.cost ?? 0;
      saleCOGS += costPerUnit * item.quantity;
    });
    return acc + saleCOGS;
  }, 0);

  const totalOverheadExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
  const netEarnings = totalRevenue - totalCOGS - totalOverheadExpenses;

  // Build unified accounting ledger movements (incomes & expenses)
  const allMovements = useMemo(
    () => buildAccountingMovements(expenses, successfulSales),
    [expenses, successfulSales]
  );

  // Overall totals for tab badge counts
  const allTotals = useMemo(
    () => calculateAccountingTotals(allMovements),
    [allMovements]
  );

  // Filtered movements based on type, category, and search text
  const filteredMovements = useMemo(
    () =>
      filterAccountingMovements(allMovements, {
        type: movementTypeFilter,
        category: categoryFilter,
        searchQuery,
      }),
    [allMovements, movementTypeFilter, categoryFilter, searchQuery]
  );

  // Filtered totals for the live summary strip and footer
  const filteredTotals = useMemo(
    () => calculateAccountingTotals(filteredMovements),
    [filteredMovements]
  );

  return (
    <div className="space-y-6 transition-all duration-300">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between border-b pb-4 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <Scale className="h-5 w-5 text-amber-500" /> Contabilidad y Libro Diario del ERP
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Control de ingresos por facturación de mostrador versus egresos de capital por materias primas y servicios básicos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto select-none">
          <button
            id="btn-add-expense-trigger"
            onClick={() => setShowExpenseModal(true)}
            className="py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 cursor-pointer flex items-center gap-1.5 shadow-sm hover:shadow-md h-9 shrink-0 transition-all"
          >
            <Plus className="h-4 w-4" /> Registrar Egreso / Gasto
          </button>

          <button
            id="btn-export-expenses"
            onClick={() => exportExpensesToCSV(expenses)}
            className="py-2.5 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 text-xs font-bold flex items-center gap-1.5 h-9 shrink-0 transition-all cursor-pointer"
          >
            <Download className="h-4 w-4" /> Exportar Planilla (CSV)
          </button>
        </div>
      </div>

      {/* REAL TIME EARNING SUMMARY BENTO BLOCKS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenues */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900">
            <TrendingUp className="h-6 w-6 text-emerald-600 dark:text-emerald-500 animate-pulse-slow" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Ingresos Totales (Venta)</p>
            <p className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 mt-1">
              ${totalRevenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[9px] text-emerald-600 dark:text-emerald-500 mt-1 font-bold">
              {successfulSales.length} comprobantes vigentes
            </p>
          </div>
        </div>

        {/* Dynamic COGS */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/60 font-serif">
            📖
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Costo Mercadería (COGS)</p>
            <p className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 mt-1">
              ${totalCOGS.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[9px] text-gray-405 mt-1">Estimado según costos panificados</p>
          </div>
        </div>

        {/* Expenses */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/25 border border-red-200 dark:border-red-900/50">
            <DollarSign className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Gastos Administrativos</p>
            <p className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 mt-1">
              ${totalOverheadExpenses.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[9px] text-red-500 mt-1 font-bold">
              {expenses.length} egresos cargados
            </p>
          </div>
        </div>

        {/* Net EBIT Margin (Profit!) */}
        <div className="p-5 rounded-2xl border flex items-center gap-4 shadow-xs bg-white dark:bg-zinc-900 border-orange-100/40 dark:border-zinc-800">
          <div
            className={`p-3 rounded-2xl border ${
              netEarnings >= 0
                ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900'
                : 'bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900'
            }`}
          >
            <HandCoins className={`h-6 w-6 ${netEarnings >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest leading-tight">Ganancia Neta Calculada</p>
            <p className={`text-xl font-extrabold mt-1 ${netEarnings >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              ${netEarnings.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[9px] text-gray-405 mt-1">Margen Neto = En tiempo real</p>
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="space-y-3 bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-4 rounded-2xl shadow-xs select-none">
        {/* Row 1: Tipo de movimiento quick tabs & search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Quick tab pills for movement type */}
          <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-zinc-850 rounded-xl">
            <button
              type="button"
              id="tab-filter-todos"
              onClick={() => setMovementTypeFilter('todos')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                movementTypeFilter === 'todos'
                  ? 'bg-white dark:bg-zinc-900 text-gray-850 dark:text-zinc-100 shadow-xs'
                  : 'text-gray-500 hover:text-gray-800 dark:text-zinc-400'
              }`}
            >
              <span>🔄 Todos</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300">
                {allTotals.count}
              </span>
            </button>
            <button
              type="button"
              id="tab-filter-ingresos"
              onClick={() => {
                setMovementTypeFilter('ingreso');
                if (categoryFilter !== 'todos' && categoryFilter !== 'ventas') {
                  setCategoryFilter('todos');
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                movementTypeFilter === 'ingreso'
                  ? 'bg-emerald-500 text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-800 dark:text-zinc-400'
              }`}
            >
              <span>📈 Ingresos</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  movementTypeFilter === 'ingreso'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                }`}
              >
                {allTotals.incomeCount}
              </span>
            </button>
            <button
              type="button"
              id="tab-filter-egresos"
              onClick={() => {
                setMovementTypeFilter('egreso');
                if (categoryFilter === 'ventas') {
                  setCategoryFilter('todos');
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                movementTypeFilter === 'egreso'
                  ? 'bg-red-500 text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-800 dark:text-zinc-400'
              }`}
            >
              <span>📉 Egresos</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  movementTypeFilter === 'egreso'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-100 text-red-800 dark:bg-red-955/40 dark:text-red-400'
                }`}
              >
                {allTotals.expenseCount}
              </span>
            </button>
          </div>

          {/* Search input */}
          <div className="relative flex-1 sm:max-w-xs">
            <input
              id="expenses-query"
              type="text"
              placeholder="Buscar por concepto, ID, comprobante..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl py-2.5 pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-800 dark:text-zinc-100 font-semibold"
            />
            <Search className="absolute left-2.5 top-3 h-3.5 w-3.5 text-gray-400" />
          </div>
        </div>

        {/* Row 2: Selectors for movement type and category */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Movement Type Select */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block mb-1">
              Tipo de Movimiento
            </label>
            <select
              id="filter-movement-type"
              value={movementTypeFilter}
              onChange={e => {
                const val = e.target.value as 'todos' | 'ingreso' | 'egreso';
                setMovementTypeFilter(val);
                if (val === 'ingreso' && categoryFilter !== 'todos' && categoryFilter !== 'ventas') {
                  setCategoryFilter('todos');
                } else if (val === 'egreso' && categoryFilter === 'ventas') {
                  setCategoryFilter('todos');
                }
              }}
              className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl p-2.5 focus:outline-none text-gray-700 dark:text-zinc-300 cursor-pointer"
            >
              <option value="todos">🔄 Todos los movimientos (Ingresos y Egresos)</option>
              <option value="ingreso">📈 Solo Ingresos (Ventas cobradas)</option>
              <option value="egreso">📉 Solo Egresos (Gastos administrativos)</option>
            </select>
          </div>

          {/* Category Select */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block mb-1">
              Rubro / Categoría
            </label>
            <select
              id="filter-exp-category"
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 rounded-xl p-2.5 focus:outline-none text-gray-700 dark:text-zinc-300 cursor-pointer"
            >
              <option value="todos">🗂️ Todas las Categorías</option>
              {(movementTypeFilter === 'todos' || movementTypeFilter === 'ingreso') && (
                <option value="ventas">🛒 Ventas / Mostrador</option>
              )}
              {(movementTypeFilter === 'todos' || movementTypeFilter === 'egreso') && (
                <>
                  <option value="materia_prima">🌾 Materia Prima / Harinas / Huevos</option>
                  <option value="servicios">⚡ Servicios Públicos / Electricidad / Agua</option>
                  <option value="alquiler">🏢 Alquiler Local Comercial</option>
                  <option value="salarios">👔 Sueldos / Panaderos y Empleados</option>
                  <option value="otros">🛒 Otros Costos indirectos</option>
                </>
              )}
            </select>
          </div>
        </div>

        {/* Row 3: Live Totals Strip of Filtered Results */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-zinc-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-gray-700 dark:text-zinc-300">
              {filteredTotals.count} {filteredTotals.count === 1 ? 'movimiento' : 'movimientos'}
            </span>
            <span className="text-[10px] text-gray-400">
              ({movementTypeFilter === 'todos' ? 'Ingresos y Egresos' : movementTypeFilter === 'ingreso' ? 'Ingresos' : 'Egresos'})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {(movementTypeFilter === 'todos' || movementTypeFilter === 'ingreso') && (
              <div className="flex items-center gap-1.5 font-bold">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">Ingresos:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">
                  +{formatCurrency(filteredTotals.totalIncome)}
                </span>
              </div>
            )}

            {(movementTypeFilter === 'todos' || movementTypeFilter === 'egreso') && (
              <div className="flex items-center gap-1.5 font-bold">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">Egresos:</span>
                <span className="font-mono text-red-600 dark:text-red-400">
                  -{formatCurrency(filteredTotals.totalExpense)}
                </span>
              </div>
            )}

            {movementTypeFilter === 'todos' && (
              <div className="flex items-center gap-1.5 font-bold border-l pl-3 border-gray-200 dark:border-zinc-700">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">Neto:</span>
                <span
                  className={`font-mono ${
                    filteredTotals.netBalance >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {filteredTotals.netBalance >= 0 ? '+' : ''}
                  {formatCurrency(filteredTotals.netBalance)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DOUBLE COMPONENT ROW: EXPENSES & SALES DIARIO LEDGER SHEET */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none border-b border-gray-100 dark:border-zinc-800">
              <tr>
                <th className="py-4 px-5">ID / Comprobante</th>
                <th className="py-4 px-3">Tipo</th>
                <th className="py-4 px-5">Concepto detallado</th>
                <th className="py-4 px-5">Categoría Contable</th>
                <th className="py-4 px-5">Fecha del Asiento</th>
                <th className="py-4 px-5">Medio de Pago</th>
                <th className="py-4 px-5 text-right">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60 font-semibold text-gray-800 dark:text-zinc-200">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    <AlertCircle className="h-8 w-8 mx-auto opacity-20 mb-2" />
                    <p className="font-bold">
                      {movementTypeFilter === 'ingreso'
                        ? 'No se registran ingresos que coincidan con la búsqueda'
                        : movementTypeFilter === 'egreso'
                        ? 'No se registran egresos que coincidan con la búsqueda'
                        : 'No se registran movimientos que coincidan con la búsqueda'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredMovements.map(m => (
                  <tr key={`${m.type}-${m.id}`} className="hover:bg-gray-50/50 dark:hover:bg-zinc-850/30">
                    <td className="py-4 px-5 font-mono text-[10px] text-zinc-400 italic">
                      {m.type === 'ingreso' ? `#${m.id}` : m.id}
                    </td>
                    <td className="py-4 px-3">
                      {m.type === 'ingreso' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-500/20">
                          <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          Ingreso
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-955/35 dark:text-red-400 border border-red-500/20">
                          <ArrowDownRight className="w-3 h-3 text-red-600 dark:text-red-400" />
                          Egreso
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-5">
                      <div className="font-bold text-gray-850 dark:text-zinc-100">{m.concept}</div>
                      {m.rawSale?.customerName && (
                        <div className="text-[10px] text-gray-400 font-normal">
                          Cliente: {m.rawSale.customerName} {m.rawSale.customerDoc ? `(${m.rawSale.customerDoc})` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-5 capitalize font-medium">
                      {m.type === 'ingreso' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300 border border-emerald-500/10">
                          {m.categoryLabel}
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            m.category === 'materia_prima'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-955/35 dark:text-amber-400'
                              : m.category === 'servicios'
                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-955/35 dark:text-sky-400'
                              : m.category === 'alquiler'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-955/35 dark:text-purple-400'
                              : m.category === 'salarios'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-955/35 dark:text-emerald-400'
                              : 'bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          {m.categoryLabel}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-5 text-gray-500 font-medium whitespace-nowrap">
                      {new Date(m.date).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="py-4 px-5 text-gray-500 font-medium">
                      {m.paymentMethod}
                    </td>
                    <td
                      className={`py-4 px-5 text-right font-mono font-extrabold text-sm ${
                        m.type === 'ingreso'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-650 dark:text-red-400'
                      }`}
                    >
                      {m.type === 'ingreso' ? '+' : '-'}
                      {formatCurrency(m.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredMovements.length > 0 && (
              <tfoot className="bg-gray-50/80 dark:bg-zinc-950/80 border-t-2 border-gray-200 dark:border-zinc-700 font-bold text-xs select-none">
                <tr>
                  <td colSpan={6} className="py-3.5 px-5 text-gray-500 uppercase tracking-wider text-[10px]">
                    Total Movimientos Listados ({filteredMovements.length})
                  </td>
                  <td
                    className={`py-3.5 px-5 text-right font-mono font-black text-sm ${
                      filteredTotals.netBalance >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {filteredTotals.netBalance >= 0 ? '+' : ''}
                    {formatCurrency(filteredTotals.netBalance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* DIALOG MODAL: LOG NEW OVERHEAD EXPENSE */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 animate-fade-in dialog-overlay">
          <form
            onSubmit={handleExpenseSubmit}
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-800 max-w-sm w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2.5 border-gray-100 dark:border-zinc-800">
              <h3 className="font-extrabold text-base text-gray-850 dark:text-zinc-50 flex items-center gap-1.5 font-sans">
                📉 Asentar Egreso Administrativo
              </h3>
              <button
                type="button"
                id="btn-expense-modal-close"
                onClick={() => setShowExpenseModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Concepto Detallado</label>
              <input
                id="modal-exp-concept"
                type="text"
                required
                placeholder="Por ej: Combustible para furgón de reparto"
                value={expConcept}
                onChange={e => setExpConcept(e.target.value)}
                className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Rubro de Gasto</label>
                <select
                  id="modal-exp-category"
                  value={expCategory}
                  onChange={e => setExpCategory(e.target.value as Expense['category'])}
                  className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100 font-bold"
                >
                  <option value="materia_prima">Materia Prima</option>
                  <option value="servicios">Servicios Públicos</option>
                  <option value="alquiler">Alquiler Local</option>
                  <option value="salarios">Sueldos / Salarios</option>
                  <option value="otros">Otros Gastos</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider font-semibold">Monto ($)</label>
                <input
                  id="modal-exp-amount"
                  type="number"
                  step="0.01"
                  required
                  min="0.5"
                  value={expAmount}
                  onChange={e => setExpAmount(Number(e.target.value))}
                  className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Medio / Forma de Pago</label>
              <select
                id="modal-exp-pm"
                value={expPaymentMethod}
                onChange={e => setExpPaymentMethod(e.target.value)}
                className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100 font-bold"
              >
                <option value="Transferencia Bancaria">🏦 Transferencia Bancaria</option>
                <option value="Efectivo de Caja Chica">💵 Efectivo de Caja Chica</option>
                <option value="Débito Automático">💳 Débito de Cuenta</option>
                <option value="Tarjeta de Crédito Corporativa">💳 Tarjeta Corporativa</option>
              </select>
            </div>

            <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2 select-none">
              <button
                type="button"
                id="btn-expense-modal-cancel"
                onClick={() => setShowExpenseModal(false)}
                className="flex-1 py-3 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-850 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-104 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                id="btn-expense-modal-submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Asentar Egreso
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
