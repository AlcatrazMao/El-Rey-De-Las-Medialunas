import {
  Coins,
  Lock,
  Unlock,
  History,
  CircleAlert,
  Clock,
  ShieldAlert,
  X,
  Plus,
  Minus,
  Banknote,
  ArrowLeft,
} from 'lucide-react';
import * as React from 'react'
import { useState, useRef, useEffect } from 'react';

import { useApp } from '../AppContext';
import { useSettings } from '../hooks/useSettings';
import { formatCurrency } from '../utils/format';

// Denominaciones ARS vigentes
const DENOMINATIONS: { value: number; label: string; bg: string; border: string }[] = [
  { value: 100,    label: '$ 100',     bg: 'bg-amber-700',   border: 'border-amber-600' },
  { value: 200,    label: '$ 200',     bg: 'bg-red-700',     border: 'border-red-600' },
  { value: 500,    label: '$ 500',     bg: 'bg-violet-700',  border: 'border-violet-600' },
  { value: 1000,   label: '$ 1.000',   bg: 'bg-purple-800',  border: 'border-purple-700' },
  { value: 2000,   label: '$ 2.000',   bg: 'bg-teal-700',    border: 'border-teal-600' },
  { value: 5000,   label: '$ 5.000',   bg: 'bg-orange-600',  border: 'border-orange-500' },
  { value: 10000,  label: '$ 10.000',  bg: 'bg-emerald-700', border: 'border-emerald-600' },
  { value: 20000,  label: '$ 20.000',  bg: 'bg-blue-700',    border: 'border-blue-600' },
  { value: 50000,  label: '$ 50.000',  bg: 'bg-rose-700',    border: 'border-rose-600' },
  { value: 100000, label: '$ 100.000', bg: 'bg-slate-600',   border: 'border-slate-500' },
];

export const CashSessionView: React.FC = () => {
  const {
    currentCashSession,
    cashSessionsHistory,
    openCashSession,
    closeCashSession,
    closeHistoricalSession,
    activeUser,
    loadMoreSessions,
    hasMoreSessions,
    setActiveTab,
    isCheckingRemoteSession,
  } = useApp();

  const { settings } = useSettings();

  const [openingAmount, setOpeningAmount] = useState<number>(0);
  const [openingMode, setOpeningMode] = useState<'manual' | 'billetes'>(settings.cash.defaultOpeningMode ?? 'billetes');
  const [openingNote, setOpeningNote] = useState<string>(settings.cash.defaultOpeningNote);
  const [closingAmount, setClosingAmount] = useState<number>(0);
  const [closingNote, setClosingNote] = useState<string>(settings.cash.defaultClosingNote);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [closingHistoricalId, setClosingHistoricalId] = useState<string | null>(null);
  const [historicalClosingAmount, setHistoricalClosingAmount] = useState<number>(0);
  const [historicalClosingNote, setHistoricalClosingNote] = useState<string>('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [highlightOpenSession, setHighlightOpenSession] = useState(false);
  const openSessionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showHistoryModal && highlightOpenSession && openSessionRef.current) {
      const timer = setTimeout(() => {
        openSessionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [showHistoryModal, highlightOpenSession]);

  // Contador de billetes — claves como string para evitar coerción implícita
  const [billCounts, setBillCounts] = useState<Record<string, number>>({});

  const setBill = (value: number, qty: number) => {
    setBillCounts(prev => ({ ...prev, [String(value)]: Math.max(0, qty) }));
  };

  // Suma siempre recalculada en render — sin useMemo para evitar stale closures
  const billTotal = DENOMINATIONS.reduce(
    (sum, d) => sum + (billCounts[String(d.value)] ?? 0) * d.value,
    0,
  );

  const resetBills = () => setBillCounts({});

  const applyBillTotal = () => {
    if (billTotal === 0) return;
    if (currentCashSession) setClosingAmount(billTotal);
    else setOpeningAmount(billTotal);
  };

  const openHistoricalSession = cashSessionsHistory.find(s => s.status === 'open');

  const handleOpen = (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveAmount = openingMode === 'billetes' ? billTotal : openingAmount;
    if (effectiveAmount < 0) return;
    if (openHistoricalSession) {
      setHighlightOpenSession(true);
      setShowHistoryModal(true);
      return;
    }
    openCashSession(effectiveAmount, openingNote);
    setOpeningAmount(settings.cash.defaultOpeningAmount);
    setOpeningNote(settings.cash.defaultOpeningNote);
    setOpeningMode(settings.cash.defaultOpeningMode ?? 'billetes');
    resetBills();
    setActiveTab('pos');
  };

  const handleClose = (e: React.FormEvent) => {
    e.preventDefault();
    if (closingAmount < 0) return;
    closeCashSession(closingAmount, closingNote);
    setShowConfirmClose(false);
    setClosingAmount(0);
    setClosingNote(settings.cash.defaultClosingNote);
    resetBills();
  };

  const handleCloseHistorical = (sessionId: string) => {
    closeHistoricalSession(sessionId, historicalClosingAmount, historicalClosingNote || undefined);
    setClosingHistoricalId(null);
    setHistoricalClosingAmount(0);
    setHistoricalClosingNote('');
  };

  return (
    <div className="space-y-6" id="cash-session-view-container">

      {/* Overview bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-5 border border-amber-500/20 dark:border-zinc-800 rounded-3xl">
        <div>
          <span className="text-xs font-black tracking-widest text-amber-600 dark:text-amber-500 uppercase">Tesorería • Control de Flujo</span>
          <h2 className="text-2xl font-black text-gray-850 dark:text-zinc-100 flex items-center gap-2 mt-1">
            🏦 Control de Apertura y Cierre de Caja
          </h2>
          <p className="text-xs text-gray-450 dark:text-zinc-400 mt-1">
            Garantiza la seguridad de los ingresos diarios haciendo habilitaciones de turno, arqueos ciegos y rendición de cuentas.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 px-4 py-2.5 rounded-2xl shadow-xs self-start sm:self-auto">
          <div className={`w-3 h-3 rounded-full ${currentCashSession ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs font-extrabold text-gray-700 dark:text-zinc-200">
            Caja Chica: {currentCashSession ? '🔓 ABIERTA' : '🔒 CERRADA'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── Columna izquierda: formulario ── */}
        <div className="lg:col-span-5">
          {!currentCashSession ? (

            /* APERTURA */
            <div className="bg-white dark:bg-zinc-900 border border-emerald-500/15 dark:border-zinc-800 shadow-md rounded-3xl p-5 md:p-6 space-y-5">
              {/* Cabecera con HISTORIAL visible */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 rounded-2xl">
                    <Unlock className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-gray-800 dark:text-zinc-100">Apertura de Caja Chica</h3>
                    <p className="text-[11px] text-gray-450 dark:text-zinc-400">Inicia el turno con el saldo de cambio</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-amber-500/10 dark:bg-zinc-800 dark:hover:bg-amber-500/10 border border-gray-200 dark:border-zinc-700 hover:border-amber-500/30 text-gray-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  Historial
                </button>
              </div>

              {/* Warning si hay sesión histórica abierta */}
              {openHistoricalSession && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-3.5 flex items-start gap-2.5">
                  <CircleAlert className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black text-orange-700 dark:text-orange-400">Hay un turno sin cerrar del {new Date(openHistoricalSession.openedAt).toLocaleDateString()}</p>
                    <p className="text-[10px] text-orange-600 dark:text-orange-500 mt-0.5">Al abrir una nueva sesión, la anterior quedará registrada como no rendida.</p>
                    <button
                      type="button"
                      onClick={() => setShowHistoryModal(true)}
                      className="text-[10px] font-black text-orange-700 dark:text-orange-400 underline mt-1 cursor-pointer"
                    >
                      Ver historial y cerrar →
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleOpen} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="openingAmount" className="text-[10px] font-black uppercase text-gray-400 dark:text-zinc-400 tracking-wider">
                      Monto Inicial de Caja ($) *
                    </label>
                    {/* Switch Manual / Billetes */}
                    <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-zinc-800 p-0.5 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setOpeningMode('manual')}
                        className={`text-[10px] font-black py-1 px-2.5 rounded-md transition-all cursor-pointer ${openingMode === 'manual' ? 'bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600'}`}
                      >
                        Manual
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpeningMode('billetes')}
                        className={`text-[10px] font-black py-1 px-2.5 rounded-md transition-all cursor-pointer flex items-center gap-1 ${openingMode === 'billetes' ? 'bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600'}`}
                      >
                        <Banknote className="w-3 h-3" />
                        Billetes
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-extrabold text-sm ${openingMode === 'billetes' ? 'text-emerald-500' : 'text-gray-400'}`}>$</span>
                    {openingMode === 'manual' ? (
                      <input
                        id="openingAmount"
                        type="number"
                        required
                        min="0"
                        step="any"
                        value={openingAmount === 0 ? '' : openingAmount}
                        onChange={e => setOpeningAmount(parseFloat(e.target.value) || 0)}
                        className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-4 pl-8 text-base font-extrabold text-gray-805 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                        placeholder="Ingresá el monto..."
                      />
                    ) : (
                      <div className="w-full bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-300/50 dark:border-emerald-700/30 rounded-2xl p-4 pl-8 flex items-center justify-between">
                        <span className={`text-base font-extrabold tabular-nums ${billTotal > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-400 dark:text-zinc-600'}`}>
                          {billTotal > 0 ? billTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 }) : 'Contá los billetes →'}
                        </span>
                        {billTotal > 0 && (
                          <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-lg">
                            Auto
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="openingNote" className="text-[10px] font-black uppercase text-gray-400 dark:text-zinc-400 tracking-wider block mb-1.5">
                    Notas de Apertura
                  </label>
                  <textarea
                    id="openingNote"
                    rows={2}
                    value={openingNote}
                    onChange={e => setOpeningNote(e.target.value)}
                    className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-3 text-xs text-gray-805 dark:text-zinc-200 focus:border-amber-500 outline-none"
                    placeholder="Ej: Caja con cambio chico de $100, $200 y $500."
                  />
                </div>

                <div className="bg-amber-500/5 border border-amber-500/10 p-3.5 rounded-2xl flex items-start gap-2.5">
                  <CircleAlert className="w-4 h-4 shrink-0 text-amber-550 mt-0.5" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                    <strong className="font-extrabold text-gray-800 dark:text-white">"{activeUser.name}"</strong> quedará asignado como responsable del turno.
                  </p>
                </div>

                <button
                  type="submit"
                  id="btn-confirm-cash-opening"
                  disabled={isCheckingRemoteSession}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-wait text-white font-extrabold text-xs tracking-wider uppercase rounded-2xl shadow-md shadow-emerald-500/10 transition-all hover:scale-[1.01] cursor-pointer"
                >
                  {isCheckingRemoteSession ? '🔍 Verificando caja remota…' : '🚀 Abrir Caja de Turno'}
                </button>
              </form>
            </div>

          ) : (

            /* CIERRE */
            <div className="bg-white dark:bg-zinc-900 border border-amber-500/15 dark:border-zinc-800 shadow-md rounded-3xl p-5 md:p-6 space-y-5">
              {/* Cabecera con HISTORIAL visible */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-450 rounded-2xl">
                    <Lock className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-gray-800 dark:text-zinc-100">Cierre y Arqueo de Caja</h3>
                    <p className="text-[11px] text-gray-450 dark:text-zinc-400">Conteo físico para rendir cuentas del turno</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-amber-500/10 dark:bg-zinc-800 dark:hover:bg-amber-500/10 border border-gray-200 dark:border-zinc-700 hover:border-amber-500/30 text-gray-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  Historial
                </button>
              </div>

              {/* Resumen del turno */}
              <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-2xl space-y-3.5 border border-gray-100 dark:border-zinc-850">
                <div className="grid grid-cols-2 gap-3 pb-3 border-b border-gray-200/50 dark:border-zinc-800">
                  <div>
                    <span className="text-[8.5px] text-gray-400 font-bold uppercase block">Fondo de Apertura</span>
                    <span className="text-sm font-black text-gray-700 dark:text-zinc-350">${currentCashSession.initialAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div>
                    <span className="text-[8.5px] text-gray-400 font-bold uppercase block">Hora de Apertura</span>
                    <span className="text-[11px] font-black text-gray-700 dark:text-zinc-350">{new Date(currentCashSession.openedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[9px] text-amber-600 dark:text-amber-400 font-black uppercase tracking-wider block">Ventas en efectivo</span>
                    <p className="text-[10px] text-gray-400 font-semibold mt-0.5">Sumatorias del turno</p>
                  </div>
                  <span className="text-sm font-extrabold text-emerald-600">
                    + ${(currentCashSession.expectedAmount - currentCashSession.initialAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2.5 border-t border-dashed border-gray-200 dark:border-zinc-800">
                  <div>
                    <span className="text-[10px] text-gray-800 dark:text-zinc-100 font-black block uppercase tracking-wide">Caja total esperada</span>
                    <p className="text-[10px] text-gray-400 font-semibold mt-0.5">Fondo + Ventas</p>
                  </div>
                  <span className="text-base font-black text-gray-850 dark:text-zinc-50">
                    ${currentCashSession.expectedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <form onSubmit={e => { e.preventDefault(); setShowConfirmClose(true); }} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="closingAmount" className="text-[10px] font-black uppercase text-gray-450 dark:text-zinc-300 tracking-wider block">
                      Efectivo real en caja ($) *
                    </label>
                    {/* TODO: requiere arqueo manual — esta acción setea realAmount = expectedAmount sin contar billetes reales, generando discrepancy=0 falsa. Mantener solo como atajo opt-in del cajero (jamás auto-disparar). */}
                    <button
                      type="button"
                      onClick={() => setClosingAmount(currentCashSession.expectedAmount)}
                      className="text-[10px] text-amber-600 hover:text-amber-700 font-extrabold cursor-pointer hover:underline"
                    >
                      Copiar esperado
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-extrabold text-sm">$</span>
                    <input
                      id="closingAmount"
                      type="number"
                      required
                      min="0"
                      step="any"
                      value={closingAmount === 0 ? '' : closingAmount}
                      onChange={e => setClosingAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-4 pl-8 text-base font-extrabold text-amber-650 dark:text-amber-450 focus:ring-2 focus:ring-amber-500/10 focus:border-amber-500 outline-none transition-all"
                      placeholder="Usá el contador de billetes →"
                    />
                  </div>
                </div>

                {closingAmount > 0 && (
                  <div className={`p-4 rounded-2xl border space-y-1 ${
                    closingAmount === currentCashSession.expectedAmount
                      ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-400'
                      : closingAmount > currentCashSession.expectedAmount
                      ? 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400'
                      : 'bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400'
                  }`}>
                    <p className="text-[10px] font-black uppercase tracking-wider">Cálculo de consistencia</p>
                    <div className="flex justify-between items-center text-xs">
                      <span>Diferencia:</span>
                      <strong className="font-extrabold text-sm">
                        {closingAmount === currentCashSession.expectedAmount
                          ? `✓ Caja Cuadrada (${formatCurrency(0)})`
                          : closingAmount > currentCashSession.expectedAmount
                          ? `📈 Sobrante: +${formatCurrency(closingAmount - currentCashSession.expectedAmount)}`
                          : `📉 Faltante: -${formatCurrency(currentCashSession.expectedAmount - closingAmount)}`}
                      </strong>
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="closingNote" className="text-[10px] font-black uppercase text-gray-400 dark:text-zinc-400 tracking-wider block mb-1.5">
                    Comentario de arqueo
                  </label>
                  <textarea
                    id="closingNote"
                    rows={2}
                    value={closingNote}
                    onChange={e => setClosingNote(e.target.value)}
                    className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-3 text-xs text-gray-805 dark:text-zinc-200 focus:border-amber-500 outline-none"
                    placeholder="Causa de sobrante o faltante"
                  />
                </div>

                {showConfirmClose ? (
                  <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl space-y-3">
                    <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 shrink-0" /> ¿Confirmás el arqueo final?
                    </p>
                    <p className="text-[10.5px] text-gray-500 dark:text-zinc-400 leading-normal">
                      Se bloquearán ventas en efectivo hasta una nueva habilitación.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        id="btn-close-and-submit-confirmed"
                        onClick={handleClose}
                        className="flex-1 py-2.5 bg-red-650 hover:bg-red-700 text-white rounded-xl text-xs font-black cursor-pointer uppercase tracking-wider"
                      >
                        Sí, cerrar caja 🔒
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowConfirmClose(false)}
                        className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 text-gray-500 dark:text-zinc-300 rounded-xl text-xs font-extrabold cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="submit"
                    id="btn-close-cash-drawer"
                    className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs tracking-wider uppercase rounded-2xl shadow-md shadow-amber-500/10 transition-all hover:scale-[1.01] cursor-pointer"
                  >
                    🔒 Guardar Arqueo y Rendir Caja
                  </button>
                )}
              </form>
            </div>
          )}
        </div>

        {/* ── Columna derecha: contador de billetes ── */}
        <div className="lg:col-span-7">
          <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 shadow-xs rounded-3xl p-5 md:p-6 h-full flex flex-col gap-5">

            {/* Header contador */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
                  <Banknote className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-100">Contador de Billetes</h3>
                  <p className="text-[10px] text-gray-450 dark:text-zinc-400">Ingresá la cantidad de cada denominación</p>
                </div>
              </div>
              {billTotal > 0 && (
                <button
                  type="button"
                  onClick={resetBills}
                  className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-red-500 font-extrabold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" /> Limpiar
                </button>
              )}
            </div>

            {/* Billetes — 2 columnas */}
            <div className="grid grid-cols-2 gap-2.5 flex-1">
              {DENOMINATIONS.map(d => {
                const key = String(d.value);
                const qty = billCounts[key] ?? 0;
                const subtotal = qty * d.value;
                return (
                  <div
                    key={d.value}
                    className={`rounded-2xl border-2 overflow-hidden transition-all ${d.border} ${qty > 0 ? 'shadow-lg' : 'opacity-70 hover:opacity-100'}`}
                  >
                    {/* Frente del billete */}
                    <div className={`${d.bg} px-3 pt-2.5 pb-2`}>
                      <div className="flex items-center justify-between">
                        <span className="text-white font-black text-sm tracking-tight">{d.label}</span>
                        {subtotal > 0 && (
                          <span className="text-white/80 text-[9px] font-black">= {formatCurrency(subtotal)}</span>
                        )}
                      </div>
                      {/* Líneas decorativas del billete */}
                      <div className="mt-1.5 space-y-0.5">
                        <div className="h-0.5 bg-white/15 rounded-full" />
                        <div className="h-0.5 bg-white/8 rounded-full w-2/3" />
                      </div>
                    </div>
                    {/* Controles */}
                    <div className="bg-white dark:bg-zinc-900 flex items-center justify-between px-2.5 py-2 gap-1">
                      <button
                        type="button"
                        onClick={() => setBill(d.value, qty - 1)}
                        disabled={qty === 0}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={qty === 0 ? '' : qty}
                        onChange={e => setBill(d.value, parseInt(e.target.value, 10) || 0)}
                        placeholder="0"
                        className="w-10 text-center text-sm font-black text-gray-800 dark:text-zinc-100 bg-transparent outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setBill(d.value, qty + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-600 dark:text-zinc-300 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total y botón aplicar */}
            <div className="bg-gradient-to-r from-amber-500/10 to-amber-500/5 border border-amber-500/25 rounded-2xl p-4 flex items-center justify-between gap-4 mt-auto">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 mb-0.5">Total contado</p>
                <p className={`text-2xl font-black tabular-nums transition-all ${billTotal > 0 ? 'text-gray-850 dark:text-zinc-50' : 'text-gray-300 dark:text-zinc-700'}`}>
                  {formatCurrency(billTotal)}
                </p>
              </div>
              <button
                type="button"
                onClick={applyBillTotal}
                disabled={billTotal === 0}
                className="shrink-0 px-5 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-100 dark:disabled:bg-zinc-800 disabled:text-gray-400 dark:disabled:text-zinc-600 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] disabled:scale-100 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-amber-500/20"
              >
                Usar este monto →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal Historial ── */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl overflow-hidden">

              {/* Header modal */}
              <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowHistoryModal(false); setHighlightOpenSession(false); }}
                    className="flex items-center gap-1.5 text-xs font-black text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" /> Volver
                  </button>
                  <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700" />
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-500" />
                    <h3 className="font-extrabold text-sm text-gray-800 dark:text-zinc-100">Historial de Turnos</h3>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] bg-gray-100 dark:bg-zinc-950 px-2.5 py-1 rounded-lg font-extrabold text-gray-500">
                    {cashSessionsHistory.length} turnos
                  </span>
                  <button
                    type="button"
                    onClick={() => { setShowHistoryModal(false); setHighlightOpenSession(false); }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body modal */}
              <div className="p-6 space-y-4">
                {cashSessionsHistory.length === 0 ? (
                  <div className="py-16 text-center border-2 border-dashed border-gray-100 dark:border-zinc-850 rounded-2xl">
                    <Coins className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-xs text-gray-400 font-semibold">No hay cierres de caja registrados todavía.</p>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {cashSessionsHistory.map(sess => {
                      const isOpen = sess.status === 'open';
                      const hasDiscrepancy = sess.discrepancy && Math.abs(sess.discrepancy) > 0.01;
                      const isExact = !hasDiscrepancy;
                      const isPositive = sess.discrepancy && sess.discrepancy > 0;

                      return (
                        <div
                          key={sess.id}
                          ref={isOpen ? openSessionRef : undefined}
                          className={`border p-4 rounded-2xl space-y-3 transition-all ${
                            isOpen && highlightOpenSession
                              ? 'bg-orange-50/70 dark:bg-orange-950/20 border-orange-500 dark:border-orange-500 ring-2 ring-orange-400/50 dark:ring-orange-500/40 ring-offset-2 dark:ring-offset-zinc-900'
                              : isOpen
                              ? 'bg-orange-50/50 dark:bg-orange-950/10 border-orange-400/40 dark:border-orange-700/40'
                              : 'bg-gray-50/50 dark:bg-zinc-950/20 border-gray-150/70 dark:border-zinc-850 hover:border-amber-500/20'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-gray-450 shrink-0" />
                              <span className="text-[11px] font-black text-gray-800 dark:text-zinc-200">
                                {new Date(sess.openedAt).toLocaleDateString()}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                • {new Date(sess.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} a {sess.closedAt ? new Date(sess.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'sin cerrar'}
                              </span>
                            </div>
                            {isOpen ? (
                              <span className="text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wide bg-orange-500/15 text-orange-800 dark:text-orange-400 border border-orange-500/30 animate-pulse">
                                ⚠ Abierta sin cerrar
                              </span>
                            ) : (
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wide ${
                                isExact
                                  ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/15'
                                  : isPositive
                                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-500/15'
                                  : 'bg-red-500/15 text-red-800 dark:text-red-400 border border-red-500/15'
                              }`}>
                                {isExact ? 'Exacto ✓' : isPositive ? `Sobrante: +${formatCurrency(sess.discrepancy || 0)}` : `Faltante: -${formatCurrency(Math.abs(sess.discrepancy || 0))}`}
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800/80 p-3 rounded-xl">
                            <div>
                              <span className="text-[8px] text-gray-400 font-bold uppercase block">Fondo Inicial</span>
                              <strong className="text-gray-700 dark:text-zinc-300 font-black">{formatCurrency(sess.initialAmount)}</strong>
                            </div>
                            <div>
                              <span className="text-[8px] text-gray-400 font-bold uppercase block">Caja Esperada</span>
                              <strong className="text-gray-700 dark:text-zinc-350 font-black">{formatCurrency(sess.expectedAmount)}</strong>
                            </div>
                            <div>
                              <span className="text-[8px] text-gray-400 font-bold uppercase block">Arqueo Real</span>
                              <strong className="text-gray-850 dark:text-zinc-150 font-extrabold">{sess.realAmount != null ? formatCurrency(sess.realAmount) : '—'}</strong>
                            </div>
                            <div>
                              <span className="text-[8px] text-gray-400 font-bold uppercase block">Cajero</span>
                              <span className="text-amber-700 dark:text-amber-450 font-extrabold truncate block">{sess.openedBy.split(' ')[0]}</span>
                            </div>
                          </div>

                          <div className="bg-white/40 dark:bg-zinc-900/40 p-2.5 rounded-lg border border-gray-150/40 dark:border-zinc-850 text-[10.5px] italic text-gray-500 dark:text-zinc-400">
                            "{sess.note || 'Sin observaciones.'}"
                          </div>

                          {isOpen && highlightOpenSession && (
                            <div className="bg-orange-500 text-white text-[10px] font-black uppercase tracking-wider rounded-xl px-3 py-2 flex items-center gap-2">
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                              Cerrá esta sesión antes de abrir una nueva
                            </div>
                          )}

                          {isOpen && (
                            <div className="border-t border-orange-300/30 dark:border-orange-700/30 pt-3 space-y-2">
                              {closingHistoricalId === sess.id ? (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-extrabold text-xs">$</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={historicalClosingAmount === 0 ? '' : historicalClosingAmount}
                                        onChange={e => setHistoricalClosingAmount(parseFloat(e.target.value) || 0)}
                                        className="w-full bg-white dark:bg-zinc-900 border border-orange-300 dark:border-orange-700/50 rounded-xl p-2 pl-7 text-xs font-extrabold text-gray-800 dark:text-zinc-100 outline-none focus:border-orange-500"
                                        placeholder="Monto real"
                                      />
                                    </div>
                                    <input
                                      type="text"
                                      value={historicalClosingNote}
                                      onChange={e => setHistoricalClosingNote(e.target.value)}
                                      className="flex-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-2 text-xs text-gray-700 dark:text-zinc-300 outline-none focus:border-orange-400"
                                      placeholder="Motivo (opcional)"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleCloseHistorical(sess.id)}
                                      className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer transition-colors"
                                    >
                                      🔒 Confirmar cierre
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setClosingHistoricalId(null); setHistoricalClosingAmount(0); setHistoricalClosingNote(''); }}
                                      className="py-2 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 text-gray-500 dark:text-zinc-300 rounded-xl text-[10px] font-extrabold cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* TODO: requiere arqueo manual — al abrir el modal se prefiltea con expectedAmount, lo que sugiere discrepancy=0 al admin si no edita. Considerar dejar el campo vacío para forzar el conteo real. */
                                <button
                                  type="button"
                                  onClick={() => { setClosingHistoricalId(sess.id); setHistoricalClosingAmount(0); }}
                                  className="w-full py-2 bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/20 dark:hover:bg-orange-900/40 text-orange-800 dark:text-orange-300 border border-orange-300/50 dark:border-orange-700/40 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer transition-colors"
                                >
                                  🔒 Cerrar sesión pendiente
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {hasMoreSessions && (
                      <div className="pt-2 text-center">
                        <button
                          onClick={loadMoreSessions}
                          className="text-xs font-extrabold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                        >
                          Cargar más turnos →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer modal */}
              <div className="border-t border-gray-100 dark:border-zinc-800 px-6 py-4">
                <button
                  type="button"
                  onClick={() => { setShowHistoryModal(false); setHighlightOpenSession(false); }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-600 dark:text-zinc-300 font-black text-xs uppercase tracking-widest rounded-2xl transition-all cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Volver a la Caja
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
