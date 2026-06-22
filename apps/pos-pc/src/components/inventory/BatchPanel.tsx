import { Plus, X, History, AlertTriangle } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import { useApp } from '../../AppContext';
import type { Product } from '../../types';

// Extraído desde InventoryView.tsx (`ProductBatchesModal`). Refactor puramente
// de organización: la lógica, los hooks y los handlers no se modificaron; sólo
// se movió el JSX y sus imports al nuevo archivo.
export interface BatchPanelProps {
  product: Product;
  onClose: () => void;
}

export const BatchPanel: React.FC<BatchPanelProps> = ({ product, onClose }) => {
  const {
    batches = [],
    addBatch,
    requestBatchWithdrawal,
    addSystemNotification,
    withdrawalRequests = [],
  } = useApp();

  const [newBatchNumber, setNewBatchNumber] = useState(
    `L-${product.name.slice(0, 3).toUpperCase()}-${(Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 6).toUpperCase()}`
  );
  const [newQuantity, setNewQuantity] = useState(50);
  const [newElabDate, setNewElabDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newExpDate, setNewExpDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (product.durabilityDays || 3));
    return d.toISOString().split('T')[0];
  });
  const [withdrawalMode, setWithdrawalMode] = useState<'manual' | 'automatic'>('manual');

  // Show manual rollback triggers
  const [selectedBatchForRollback, setSelectedBatchForRollback] = useState<string | null>(null);
  const [rollbackQty, setRollbackQty] = useState(1);
  const [rollbackReason, setRollbackReason] = useState('Expirado de góndola, retirar lote.');

  // Recalculate expiry day on elab change
  const handleElabChange = (val: string) => {
    setNewElabDate(val);
    if (!val) return;
    const d = new Date(val + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + (product.durabilityDays || 3));
    setNewExpDate(d.toISOString().split('T')[0]);
  };

  const handleRegisterBatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchNumber.trim() || newQuantity <= 0) {
      addSystemNotification('❌ Datos Incompletos', 'Completa los requerimientos para crear el lote.', 'error');
      return;
    }

    const createdBatchNumber = newBatchNumber;
    const createdQuantity = newQuantity;

    addBatch({
      productId: product.id,
      batchNumber: createdBatchNumber,
      quantity: createdQuantity,
      stock: createdQuantity,
      elaborationDate: newElabDate,
      expiryDate: newExpDate,
      withdrawalMode,
    });

    // Reset Form
    setNewBatchNumber(
      `L-${product.name.slice(0, 3).toUpperCase()}-${(Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 6).toUpperCase()}`
    );
    setNewQuantity(50);
    addSystemNotification('📦 Lote Creado', `Se registró lote "${createdBatchNumber}" con ${createdQuantity} u.`, 'success');
  };

  const activeProductBatches = batches.filter((b) => b.productId === product.id);

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-55 p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-150 dark:border-zinc-800 shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden my-auto">

        {/* Modal Head */}
        <div className="p-5 border-b border-gray-100 dark:border-zinc-850 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-zinc-950/25 select-none">
          <div className="flex items-center gap-2.5">
            <span className="text-3xl shrink-0">{product.image}</span>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-gray-855 dark:text-zinc-50">
                Lotes de Producción: {product.name}
              </h3>
              <p className="text-[10px] text-gray-400">
                Control de fecha límite de vida útil ({product.durabilityDays || 0} días de caducidad)
              </p>
            </div>
          </div>
          <button
            id="btn-batch-modal-x"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-gray-150 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-500 cursor-pointer transition-colors active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Container */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">

          {/* Section 1: Register New Batch */}
          <div className="bg-amber-100/10 dark:bg-amber-950/10 border border-amber-500/10 dark:border-amber-900/10 rounded-2xl p-4 space-y-3.5 select-none">
            <h4 className="font-black text-xs text-amber-800 dark:text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
              <Plus className="h-4 w-4 shrink-0" /> Registrar Producción / Lote Nuevo
            </h4>

            <form onSubmit={handleRegisterBatchSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Cód del Lote (Lote-Nº)</label>
                <input
                  id="batch-input-number"
                  type="text"
                  required
                  value={newBatchNumber}
                  onChange={(e) => setNewBatchNumber(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Cantidad Inicial Elaborada</label>
                <input
                  id="batch-input-qty"
                  type="number"
                  min="1"
                  required
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(Number(e.target.value))}
                  className="w-full font-mono bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Elaboración / Ingreso</label>
                <input
                  id="batch-input-elab"
                  type="date"
                  required
                  value={newElabDate}
                  onChange={(e) => handleElabChange(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase">Fecha de Caducidad Calculada</label>
                <input
                  id="batch-input-exp"
                  type="date"
                  required
                  value={newExpDate}
                  onChange={(e) => setNewExpDate(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-150"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-[9.5px] font-extrabold text-gray-400 uppercase block">Modo de Baja al Caducar</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    id="btn-mode-manual"
                    onClick={() => setWithdrawalMode('manual')}
                    className={`py-2 px-3.5 border rounded-xl font-bold transition-all ${
                      withdrawalMode === 'manual'
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-750 text-gray-600 dark:text-zinc-400'
                    }`}
                  >
                    Manual (A Confirmar por Admin)
                  </button>
                  <button
                    type="button"
                    id="btn-mode-auto"
                    onClick={() => setWithdrawalMode('automatic')}
                    className={`py-2 px-3.5 border rounded-xl font-bold transition-all ${
                      withdrawalMode === 'automatic'
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-750 text-gray-600 dark:text-zinc-400'
                    }`}
                  >
                    Baja Automática por Sistema
                  </button>
                </div>
                <p className="text-[9px] text-gray-400 mt-1">
                  Manual: Requiere retiro manual con aviso. Automático: El sistema genera una solicitud una vez pasada la fecha límite.
                </p>
              </div>

              <button
                type="submit"
                id="btn-batch-register"
                className="sm:col-span-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer mt-2"
              >
                Insertar y Sumar al Stock Mostrador ✓
              </button>
            </form>
          </div>

          {/* Section 2: Active Batches Table */}
          <div className="space-y-3">
            <h4 className="font-black text-xs text-gray-800 dark:text-gray-100 uppercase tracking-widest flex items-center gap-1.5 select-none">
              <History className="h-4 w-4 text-gray-400" /> Historial de Lotes Activos
            </h4>

            {activeProductBatches.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-xs italic font-bold select-none">
                No hay lotes activos para este producto. Agrega stock arriba.
              </p>
            ) : (
              <div className="space-y-3.5">
                {activeProductBatches.map((b) => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  const todayTime = new Date(todayStr + 'T00:00:00').getTime();
                  const expTime = new Date(b.expiryDate + 'T00:00:00').getTime();
                  const remainingDays = Math.ceil((expTime - todayTime) / (1000 * 60 * 60 * 24));

                  let colorClass = 'bg-emerald-500 text-white';
                  let badgeText = 'Excelente';
                  if (remainingDays < 0) {
                    colorClass = 'bg-red-500 text-white';
                    badgeText = 'Caducado';
                  } else if (remainingDays <= 1) {
                    colorClass = 'bg-amber-550 text-black';
                    badgeText = 'Por Caducar';
                  }

                  const hasPendingRequest = withdrawalRequests.some(
                    (r) => r.batchId === b.id && r.status === 'pending'
                  );

                  return (
                    <div
                      key={b.id}
                      className="bg-gray-50 dark:bg-zinc-950/40 border border-gray-150 dark:border-zinc-800/60 rounded-2xl p-4.5 space-y-3 relative overflow-hidden"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 select-none">
                            <span className="font-extrabold text-sm text-gray-855 dark:text-zinc-150">{b.batchNumber}</span>
                            <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-black ${colorClass}`}>
                              {badgeText}
                            </span>
                            <span className="bg-gray-200 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 rounded px-1 text-[8.5px] font-semibold">
                              Retiro: {b.withdrawalMode === 'automatic' ? 'Auto' : 'Manual'}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[10px] text-gray-400 select-none">
                            <span>Ingreso: <strong className="text-zinc-400 font-semibold">{b.elaborationDate}</strong></span>
                            <span>Expira: <strong className="text-zinc-400 font-semibold">{b.expiryDate}</strong></span>
                          </div>
                        </div>

                        {/* Inventory Count */}
                        <div className="bg-white dark:bg-zinc-850 border border-gray-100 dark:border-zinc-800 p-2 rounded-xl text-center min-w-[100px] select-none">
                          <span className="text-[8.5px] font-black uppercase text-gray-400 block tracking-wider">Mostrador</span>
                          <span className="text-xs font-black text-gray-855 dark:text-zinc-100 font-mono">
                            {b.stock}/{b.quantity} u.
                          </span>
                        </div>
                      </div>

                      {/* Display warning or active actions */}
                      {b.stock > 0 && (
                        <div className="pt-2 border-t border-gray-200/50 dark:border-zinc-900/50">
                          {hasPendingRequest ? (
                            <p className="text-[10px] text-amber-600 font-extrabold flex items-center gap-1 bg-amber-500/10 p-2 rounded-xl border border-amber-500/10 select-none">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-bounce" />
                              Solicitud de retiro de mercadería pendiente en el panel de administración.
                            </p>
                          ) : (
                            <>
                              {selectedBatchForRollback === b.id ? (
                                <div className="space-y-2.5 bg-amber-50 dark:bg-zinc-900/30 p-3 rounded-xl border border-amber-200 dark:border-amber-950/40">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-extrabold text-gray-400 uppercase">Cantidad a dar de baja:</label>
                                      <input
                                        id="rollback-qty-input"
                                        type="number"
                                        min="1"
                                        max={b.stock}
                                        value={rollbackQty}
                                        onChange={(e) => setRollbackQty(Math.min(b.stock, Number(e.target.value)))}
                                        className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-2 rounded-lg font-mono focus:outline-none text-zinc-800 dark:text-zinc-100"
                                      />
                                    </div>

                                    <div className="space-y-1">
                                      <label className="text-[9px] font-extrabold text-gray-400 uppercase">Detalle o Motivo:</label>
                                      <input
                                        id="rollback-reason-input"
                                        type="text"
                                        value={rollbackReason}
                                        onChange={(e) => setRollbackReason(e.target.value)}
                                        placeholder="Ej: Securas expira, rancio"
                                        className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-2 rounded-lg focus:outline-none text-zinc-800 dark:text-zinc-100"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex gap-2 text-[10px]">
                                    <button
                                      type="button"
                                      id="btn-cancel-rollback"
                                      onClick={() => setSelectedBatchForRollback(null)}
                                      className="flex-1 py-1.5 rounded-lg bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 font-extrabold cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      id="btn-submit-rollback"
                                      onClick={() => {
                                        requestBatchWithdrawal(b.id, rollbackQty, rollbackReason);
                                        setSelectedBatchForRollback(null);
                                        addSystemNotification('🔔 Solicitud Almacenada', `Se solicitó la baja de ${rollbackQty} u. del lote ${b.batchNumber}`, 'success');
                                      }}
                                      className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-extrabold cursor-pointer transition-colors active:scale-95"
                                    >
                                      Enviar Solicitud
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex justify-end select-none">
                                  <button
                                    type="button"
                                    id={`btn-init-rollback-${b.id}`}
                                    onClick={() => {
                                      setSelectedBatchForRollback(b.id);
                                      setRollbackQty(b.stock);
                                      setRollbackReason('Lote caducado, retirar de gondola de inmediato.');
                                    }}
                                    className="py-1 px-3.5 bg-red-50 hover:bg-red-105 dark:bg-red-950/20 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-[10px] font-black text-red-650 dark:text-red-400 cursor-pointer transition-all active:scale-95"
                                  >
                                    ⚠️ Solicitar Retiro de Merma
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-zinc-850/60 bg-gray-50/50 dark:bg-zinc-955 shrink-0 select-none">
          <p className="text-[10px] text-gray-400 text-center font-semibold">
            Nota: Al aprobarse un retiro preventivo por el admin de la sucursal, el stock pasará a registrarse como desecho histórico.
          </p>
        </div>

      </div>
    </div>
  );
};
