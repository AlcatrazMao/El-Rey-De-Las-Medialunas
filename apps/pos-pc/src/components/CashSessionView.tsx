import { 
  Coins, 
  Lock, 
  Unlock, 
  History, 
  CircleAlert,
  Clock,
  ShieldAlert
} from 'lucide-react';
import * as React from 'react'
import { useState } from 'react';

import { useApp } from '../AppContext';
import { useSettings } from '../hooks/useSettings';
import { formatCurrency } from '../utils/format';

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
  } = useApp();

  const { settings } = useSettings();

  // Apertura states — initialized from persisted settings
  const [openingAmount, setOpeningAmount] = useState<number>(settings.cash.defaultOpeningAmount);
  const [openingNote, setOpeningNote] = useState<string>(settings.cash.defaultOpeningNote);

  // Cierre states — closing note also pulled from settings
  const [closingAmount, setClosingAmount] = useState<number>(0);
  const [closingNote, setClosingNote] = useState<string>(settings.cash.defaultClosingNote);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Cierre de sesiones históricas abiertas (días anteriores)
  const [closingHistoricalId, setClosingHistoricalId] = useState<string | null>(null);
  const [historicalClosingAmount, setHistoricalClosingAmount] = useState<number>(0);
  const [historicalClosingNote, setHistoricalClosingNote] = useState<string>('');

  const handleCloseHistorical = (sessionId: string) => {
    closeHistoricalSession(sessionId, historicalClosingAmount, historicalClosingNote || undefined);
    setClosingHistoricalId(null);
    setHistoricalClosingAmount(0);
    setHistoricalClosingNote('');
  };

  const handleOpen = (e: React.FormEvent) => {
    e.preventDefault();
    if (openingAmount < 0) return;
    openCashSession(openingAmount, openingNote);
    // Reset to defaults from settings so next open picks up any updated config
    setOpeningAmount(settings.cash.defaultOpeningAmount);
    setOpeningNote(settings.cash.defaultOpeningNote);
  };

  const handleClose = (e: React.FormEvent) => {
    e.preventDefault();
    if (closingAmount < 0) return;
    closeCashSession(closingAmount, closingNote);
    setShowConfirmClose(false);
    setClosingAmount(0);
    setClosingNote(settings.cash.defaultClosingNote);
  };

  return (
    <div className="space-y-6" id="cash-session-view-container">
      {/* Overview/Welcome bar */}
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
        {/* Left main column: opening/closing form */}
        <div className="lg:col-span-5 space-y-6">
          {!currentCashSession ? (
            /* APERTURA DE CAJA FORM */
            <div className="bg-white dark:bg-zinc-900 border border-emerald-500/15 dark:border-zinc-800 shadow-md rounded-3xl p-5 md:p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 rounded-2xl">
                  <Unlock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-gray-800 dark:text-zinc-100">
                    Apertura de Caja Chica
                  </h3>
                  <p className="text-[11px] text-gray-450 dark:text-zinc-400">
                    Inicia el turno registrando el saldo disponible para cambio
                  </p>
                </div>
              </div>

              <form onSubmit={handleOpen} className="space-y-4">
                <div>
                  <label htmlFor="openingAmount" className="text-[10px] font-black uppercase text-gray-400 dark:text-zinc-400 tracking-wider block mb-1.5">
                    Monto Inicial de Caja ($) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-extrabold text-sm">$</span>
                    <input
                      id="openingAmount"
                      type="number"
                      required
                      min="0"
                      step="any"
                      value={openingAmount === 0 ? '' : openingAmount}
                      onChange={(e) => setOpeningAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-4 pl-8 text-base font-extrabold text-gray-805 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                      placeholder="Ej: 15000"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5 italic">
                    Sugerido: $15,000 ARS (Fondo común para cambio sencillo)
                  </p>
                </div>

                <div>
                  <label htmlFor="openingNote" className="text-[10px] font-black uppercase text-gray-400 dark:text-zinc-400 tracking-wider block mb-1.5">
                    Notas y Observaciones de Apertura
                  </label>
                  <textarea
                    id="openingNote"
                    rows={2}
                    value={openingNote}
                    onChange={(e) => setOpeningNote(e.target.value)}
                    className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-3 text-xs text-gray-805 dark:text-zinc-200 focus:border-amber-500 outline-none"
                    placeholder="Ej: Recibí caja limpia con cambio chico compuesto de billetes de 100, 200 y 500."
                  />
                </div>

                <div className="bg-amber-500/5 border border-amber-500/10 p-3.5 rounded-2xl flex items-start gap-2.5">
                  <CircleAlert className="w-4 h-4 shrink-0 text-amber-550 mt-0.5" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                    Al proceder, habilitarás el módulo de ventas de caja activa. El operador <strong className="font-extrabold text-gray-800 dark:text-white">"{activeUser.name}"</strong> quedará asignado como auditor responsable hasta su rendición.
                  </p>
                </div>

                <button
                  type="submit"
                  id="btn-confirm-cash-opening"
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs tracking-wider uppercase rounded-2xl shadow-md shadow-emerald-500/10 transition-all hover:scale-[1.01] cursor-pointer"
                >
                  🚀 Abrir Caja de Turno
                </button>
              </form>
            </div>
          ) : (
            /* CIERRE DE CAJA / ARQUEO FORM */
            <div className="bg-white dark:bg-zinc-900 border border-amber-500/15 dark:border-zinc-800 shadow-md rounded-3xl p-5 md:p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-450 rounded-2xl">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-gray-800 dark:text-zinc-100">
                    Cierre y Arqueo de Caja
                  </h3>
                  <p className="text-[11px] text-gray-450 dark:text-zinc-400">
                    Realiza el conteo físico para rendir cuentas del turno
                  </p>
                </div>
              </div>

              {/* Running summary stats */}
              <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-2xl space-y-3.5 border border-gray-100 dark:border-zinc-850">
                <div className="grid grid-cols-2 gap-3 pb-3 border-b border-gray-200/50 dark:border-zinc-800">
                  <div>
                    <span className="text-[8.5px] text-gray-400 font-bold uppercase block">Fondo de Apertura</span>
                    <span className="text-sm font-black text-gray-700 dark:text-zinc-350">${currentCashSession.initialAmount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                  </div>
                  <div>
                    <span className="text-[8.5px] text-gray-400 font-bold uppercase block">Hora de Apertura</span>
                    <span className="text-[11px] font-black text-gray-700 dark:text-zinc-350">{new Date(currentCashSession.openedAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[9px] text-amber-600 dark:text-amber-400 font-black uppercase tracking-wider block">VENTAS EN EFECTIVO</span>
                    <p className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">Sumatorias del turno corriente</p>
                  </div>
                  <span className="text-sm font-extrabold text-emerald-600">
                    + ${(currentCashSession.expectedAmount - currentCashSession.initialAmount).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-dashed border-gray-200 dark:border-zinc-800">
                  <div>
                    <span className="text-[10px] text-gray-800 dark:text-zinc-100 font-black block uppercase tracking-wide">CAJA TOTAL ESPERADA</span>
                    <p className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">Fondo Inicial + Ventas Efectivo</p>
                  </div>
                  <span className="text-base font-black text-gray-850 dark:text-zinc-50">
                    ${currentCashSession.expectedAmount.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                  </span>
                </div>
              </div>

              <form onSubmit={(e) => {
                e.preventDefault();
                setShowConfirmClose(true);
              }} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="closingAmount" className="text-[10px] font-black uppercase text-gray-450 dark:text-zinc-300 tracking-wider block">
                      EFECTIVO REAL EN CAJA ($) *
                    </label>
                    <button
                      type="button"
                      onClick={() => setClosingAmount(currentCashSession.expectedAmount)}
                      className="text-[10px] text-amber-600 hover:text-amber-700 font-extrabold cursor-pointer hover:underline"
                    >
                      Copiar Esperado
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
                      onChange={(e) => setClosingAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-4 pl-8 text-base font-extrabold text-amber-650 dark:text-amber-450 focus:ring-2 focus:ring-amber-500/10 focus:border-amber-500 outline-none transition-all"
                      placeholder="Declara la cifra exacta que contaste"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5 italic">
                    Cuenta billete por billete. El sistema calculará automáticamente si tienes un sobrante o un faltante.
                  </p>
                </div>

                {closingAmount > 0 && (
                  <div className={`p-4 rounded-2xl border ${
                    closingAmount === currentCashSession.expectedAmount 
                      ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-400' 
                      : closingAmount > currentCashSession.expectedAmount
                      ? 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400'
                      : 'bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400'
                  } space-y-1`}>
                    <p className="text-[10px] font-black uppercase tracking-wider">Cálculo de Consistencia</p>
                    <div className="flex justify-between items-center text-xs">
                      <span>Diferencia calculada de saldo:</span>
                      <strong className="font-exrabold text-sm">
                        {closingAmount === currentCashSession.expectedAmount
                          ? `✓ Caja Cuadrada (${formatCurrency(0)})`
                          : closingAmount > currentCashSession.expectedAmount
                          ? `📈 Sobrante: + ${formatCurrency(closingAmount - currentCashSession.expectedAmount)}`
                          : `📉 Faltante: - ${formatCurrency(currentCashSession.expectedAmount - closingAmount)}`}
                      </strong>
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="closingNote" className="text-[10px] font-black uppercase text-gray-400 dark:text-zinc-400 tracking-wider block mb-1.5">
                    Comentario de Arqueo / Cierre
                  </label>
                  <textarea
                    id="closingNote"
                    rows={2}
                    value={closingNote}
                    onChange={(e) => setClosingNote(e.target.value)}
                    className="w-full bg-gray-50/50 dark:bg-zinc-950 border border-gray-250 dark:border-zinc-800 rounded-2xl p-3 text-xs text-gray-805 dark:text-zinc-200 focus:border-amber-500 outline-none"
                    placeholder="Registra cualquier causa de sobrante o faltante aquí"
                  />
                </div>

                {showConfirmClose ? (
                  <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl space-y-3">
                    <p className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 shrink-0" /> ¿Confirmas arqueo final?
                    </p>
                    <p className="text-[10.5px] text-gray-500 dark:text-zinc-400 leading-normal">
                      Una vez cerrado el turno de caja, se bloquearán ventas nuevas de efectivo hasta una nueva habilitación de fondo de cambio.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        id="btn-close-and-submit-confirmed"
                        onClick={handleClose}
                        className="flex-1 py-2.5 bg-red-650 hover:bg-red-700 text-white rounded-xl text-xs font-black cursor-pointer uppercase tracking-wider"
                      >
                        Sí, Cerrar Caja 🔒
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

        {/* Right column: history & information */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 shadow-xs rounded-3xl p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-gray-850 dark:text-zinc-100">
                    Historial de Turnos de Caja
                  </h3>
                  <p className="text-[10px] text-gray-450 dark:text-zinc-400">
                    Pista de auditorías de caja del local
                  </p>
                </div>
              </div>
              <span className="text-[10px] bg-gray-100 dark:bg-zinc-950 px-2.5 py-1 rounded-lg font-extrabold text-gray-500">
                Resúmenes: {cashSessionsHistory.length}
              </span>
            </div>

            {cashSessionsHistory.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-gray-100 dark:border-zinc-850 rounded-2xl">
                <Coins className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-xs text-gray-400 font-semibold">
                  No hay registro de cierres de caja en esta consola todavía.
                </p>
                <p className="text-[10px] text-gray-450 mt-1 leading-normal max-w-sm mx-auto">
                  Por favor, abre la caja, simula cobros de ventas utilizando efectivo en el panel POS y luego cierra la caja para ver la rendición de cuentas reflejada aquí.
                </p>
              </div>
            ) : (
              <>
              <div className="space-y-3.5 max-h-[580px] overflow-y-auto pr-1">
                {cashSessionsHistory.map((sess) => {
                  const isOpen = sess.status === 'open';
                  const hasDiscrepancy = sess.discrepancy && Math.abs(sess.discrepancy) > 0.01;
                  const isExact = !hasDiscrepancy;
                  const isPositive = sess.discrepancy && sess.discrepancy > 0;

                  return (
                    <div
                      key={sess.id}
                      className={`border p-4 rounded-2xl transition-all space-y-3 ${
                        isOpen
                          ? 'bg-orange-50/50 dark:bg-orange-950/10 border-orange-400/40 dark:border-orange-700/40'
                          : 'bg-gray-50/50 dark:bg-zinc-950/20 border-gray-150/70 dark:border-zinc-850 hover:border-amber-500/20'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-gray-450 shrink-0" />
                          <span className="text-[11px] font-black text-gray-800 dark:text-zinc-200">
                            Habilitación: {new Date(sess.openedAt).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            • {new Date(sess.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} a {sess.closedAt ? new Date(sess.closedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Turno incompleto'}
                          </span>
                        </div>

                        {isOpen ? (
                          <span className="text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wide self-start sm:self-auto bg-orange-500/15 text-orange-800 dark:text-orange-400 border border-orange-500/30 animate-pulse">
                            ⚠ Abierta sin cerrar
                          </span>
                        ) : (
                          <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wide self-start sm:self-auto ${
                            isExact
                              ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-500/15'
                              : isPositive
                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-500/15'
                              : 'bg-red-505/15 text-red-800 dark:text-red-400 border border-red-500/15'
                          }`}>
                            {isExact ? 'Exacto ✓' : isPositive ? `Sobrante: +${formatCurrency(sess.discrepancy || 0)}` : `Faltante: -${formatCurrency(Math.abs(sess.discrepancy || 0))}`}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800/80 p-3 rounded-xl select-none">
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
                          <strong className="text-gray-850 dark:text-zinc-150 font-extrabold">{sess.realAmount != null ? formatCurrency(sess.realAmount) : '-'}</strong>
                        </div>
                        <div>
                          <span className="text-[8px] text-gray-400 font-bold uppercase block">Cajero de Turno</span>
                          <span className="text-amber-700 dark:text-amber-450 font-extrabold truncate block">{sess.openedBy.split(' ')[0]}</span>
                        </div>
                      </div>

                      <div className="bg-white/40 dark:bg-zinc-900/40 p-2.5 rounded-lg border border-gray-150/40 dark:border-zinc-850 text-[10.5px] italic text-gray-500 dark:text-zinc-400">
                        "{sess.note || 'Sin observaciones registradas para este arqueo.'}"
                      </div>

                      {/* Formulario de cierre para sesiones abiertas del historial */}
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
                                    onChange={(e) => setHistoricalClosingAmount(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-white dark:bg-zinc-900 border border-orange-300 dark:border-orange-700/50 rounded-xl p-2 pl-7 text-xs font-extrabold text-gray-800 dark:text-zinc-100 outline-none focus:border-orange-500"
                                    placeholder="Monto real en caja"
                                  />
                                </div>
                                <input
                                  type="text"
                                  value={historicalClosingNote}
                                  onChange={(e) => setHistoricalClosingNote(e.target.value)}
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
                                  🔒 Confirmar cierre de sesión
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
                            <button
                              type="button"
                              onClick={() => { setClosingHistoricalId(sess.id); setHistoricalClosingAmount(sess.expectedAmount); }}
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
              </div>
              {hasMoreSessions && (
                <div className="pt-3 text-center border-t border-gray-100 dark:border-zinc-800 mt-3">
                  <button
                    onClick={loadMoreSessions}
                    className="text-xs font-extrabold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    Cargar más turnos →
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
