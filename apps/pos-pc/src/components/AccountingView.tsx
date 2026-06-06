import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { exportExpensesToCSV } from '../utils/exportUtils';
import {
  HandCoins,
  TrendingUp,
  Plus,
  Search,
  Scale,
  Calendar,
  DollarSign,
  Download,
  AlertCircle,
  X,
  Sparkles
} from 'lucide-react';
import { Expense } from '../types';

export const AccountingView: React.FC = () => {
  const {
    sales,
    expenses,
    addExpense,
    products,
    addSystemNotification
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'todos' | Expense['category']>('todos');
  
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
      paymentMethod: expPaymentMethod
    });

    setExpConcept('');
    setExpCategory('materia_prima');
    setExpAmount(100);
    setExpPaymentMethod('Transferencia Bancaria');
    setShowExpenseModal(false);
  };

  // Financial calculations from completed bills
  const successfulSales = sales.filter(s => s.paymentStatus === 'completed');
  const totalRevenue = successfulSales.reduce((acc, s) => acc + s.total, 0);
  
  // Calculate COGS dynamically from sold item costs in catalog! This is extremely advanced
  const totalCOGS = successfulSales.reduce((acc, s) => {
    let saleCOGS = 0;
    s.items.forEach(item => {
      // Find matching cost in products
      const originalProd = products.find(p => p.id === item.productId);
      const costPerUnit = originalProd ? originalProd.cost : 0;
      saleCOGS += costPerUnit * item.quantity;
    });
    return acc + saleCOGS;
  }, 0);

  const totalOverheadExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
  const netEarnings = totalRevenue - totalCOGS - totalOverheadExpenses;

  // Filter operations
  const filteredExpenses = expenses.filter(exp => {
    const matchesSearch = exp.concept.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          exp.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'todos' || exp.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

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
        <div className={`p-5 rounded-2xl border flex items-center gap-4 shadow-xs bg-white dark:bg-zinc-900 border-orange-100/40 dark:border-zinc-800`}>
          <div className={`p-3 rounded-2xl border ${
            netEarnings >= 0 
              ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900' 
              : 'bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900'
          }`}>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-4 rounded-2xl shadow-xs leading-none select-none">
        {/* Search text */}
        <div className="relative">
          <input
            id="expenses-query"
            type="text"
            placeholder="Buscar egreso por concepto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-805 rounded-xl py-3 pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-805 dark:text-zinc-100 font-semibold"
          />
          <Search className="absolute left-2.5 top-3.5 h-3.5 w-3.5 text-gray-400" />
        </div>

        {/* Category select pick */}
        <select
          id="filter-exp-category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as any)}
          className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-805 rounded-xl p-3 focus:outline-none text-gray-700 dark:text-zinc-350"
        >
          <option value="todos">🗂️ Todas las Categorías de Egreso</option>
          <option value="materia_prima">🌾 Materia Prima / Harinas / Huevos</option>
          <option value="servicios">⚡ Servicios Públicos / Electricidad / Agua</option>
          <option value="alquiler">🏢 Alquiler Local Comercial</option>
          <option value="salarios">👔 Sueldos / Panaderos y Empleados</option>
          <option value="otros">🛒 Otros Costos indirectos</option>
        </select>
      </div>

      {/* DOUBLE COMPONENT ROW: EXPENSES DIARIO LEDGER SHEET */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none border-b border-gray-100 dark:border-zinc-855">
              <tr>
                <th className="py-4 px-5">ID Gasto</th>
                <th className="py-4 px-5">Concepto detallado</th>
                <th className="py-4 px-5">Categoría Contable</th>
                <th className="py-4 px-5">Fecha del Asiento</th>
                <th className="py-4 px-5">Medio de Pago</th>
                <th className="py-4 px-5 text-right">Monto Erogación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-805/60 font-semibold text-gray-800 dark:text-zinc-200">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    <AlertCircle className="h-8 w-8 mx-auto opacity-20 mb-2" />
                    <p className="font-bold">No se registran egresos que coincidan con la búsqueda</p>
                  </td>
                </tr>
              ) : (
                filteredExpenses.map(exp => (
                  <tr key={exp.id} className="hover:bg-gray-50/50 dark:hover:bg-zinc-850/30">
                    <td className="py-4 px-5 font-mono text-[10px] text-zinc-400 italic">
                      {exp.id}
                    </td>
                    <td className="py-4 px-5">
                      {exp.concept}
                    </td>
                    <td className="py-4 px-5 capitalize font-medium">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        exp.category === 'materia_prima'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-955/35 dark:text-amber-400'
                          : exp.category === 'servicios'
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-955/35 dark:text-sky-400'
                          : exp.category === 'alquiler'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-955/35 dark:text-purple-400'
                          : exp.category === 'salarios'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-955/35 dark:text-emerald-400'
                          : 'bg-gray-105 text-gray-800 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}>
                        {exp.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-gray-500 font-medium whitespace-nowrap">
                      {new Date(exp.date).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="py-4 px-5 text-gray-500 font-medium">
                      {exp.paymentMethod}
                    </td>
                    <td className="py-4 px-5 text-right font-mono font-extrabold text-red-650 dark:text-red-400 text-sm">
                      -${exp.amount.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
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
                onChange={(e) => setExpConcept(e.target.value)}
                className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Rubro de Gasto</label>
                <select
                  id="modal-exp-category"
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value as any)}
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
                  onChange={(e) => setExpAmount(Number(e.target.value))}
                  className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-705 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Medio / Forma de Pago</label>
              <select
                id="modal-exp-pm"
                value={expPaymentMethod}
                onChange={(e) => setExpPaymentMethod(e.target.value)}
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
