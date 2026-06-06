import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { 
  X, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  History, 
  Clock, 
  Package, 
  Eye 
} from 'lucide-react';

export const CajeroMermaView: React.FC = () => {
  const {
    products,
    batches,
    withdrawalRequests,
    requestBatchWithdrawal,
    addSystemNotification
  } = useApp();

  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState<string>('');

  // When selected product changes, preselect its first active batch
  const productBatches = batches.filter(
    b => b.productId === selectedProductId && b.status === 'active' && b.stock > 0
  );

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    const firstBatch = batches.find(
      b => b.productId === prodId && b.status === 'active' && b.stock > 0
    );
    setSelectedBatchId(firstBatch ? firstBatch.id : '');
    setQuantity(1);
  };

  const activeSelectedBatch = batches.find(b => b.id === selectedBatchId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedBatchId) {
      addSystemNotification('⚠️ Error de Selección', 'Selecciona un lote activo de mercadería para mermar.', 'error');
      return;
    }

    if (quantity <= 0) {
      addSystemNotification('⚠️ Cantidad Inválida', 'La cantidad debe ser mayor a 0.', 'error');
      return;
    }

    if (activeSelectedBatch && quantity > activeSelectedBatch.stock) {
      addSystemNotification(
        '⚠️ Cantidad Insuficiente', 
        `La cantidad ingresada supera el stock disponible en el lote (${activeSelectedBatch.stock} u.).`, 
        'error'
      );
      return;
    }

    if (!reason.trim()) {
      addSystemNotification('⚠️ Motivo Requerido', 'Especifica el motivo de la baja.', 'error');
      return;
    }

    requestBatchWithdrawal(selectedBatchId, quantity, reason);

    // Reset fields
    setReason('');
    setQuantity(1);
  };

  return (
    <div className="space-y-6">
      
      {/* Header section */}
      <div className="border-b border-orange-100/50 dark:border-zinc-800/60 pb-5">
        <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-red-500" /> Solicitudes de Baja de Mercadería (Mermas)
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Registra mercadería vencida, dañada o sobrante exhibida en el local para solicitar la aprobación de merma al administrador del local.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left column: Reg Form */}
        <div className="lg:col-span-5 bg-gray-50/50 dark:bg-zinc-950/20 border border-gray-150 dark:border-zinc-800 rounded-2xl p-5 h-fit space-y-4">
          <h3 className="font-extrabold text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1.5 leading-none select-none">
            <Plus className="h-3.5 w-3.5 text-amber-500" /> Nueva Solicitud de Merma
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Choose Product */}
            <div className="space-y-1">
              <label className="font-extrabold text-[10px] text-gray-400 uppercase">1. Seleccionar Producto</label>
              <select
                id="select-merma-product"
                value={selectedProductId}
                onChange={(e) => handleProductChange(e.target.value)}
                className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
              >
                <option value="" disabled>Seleccionar artículo...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.image} {p.name} (Stock: {p.stock} u.)
                  </option>
                ))}
              </select>
            </div>

            {/* Choose Batch */}
            <div className="space-y-1">
              <label className="font-extrabold text-[10px] text-gray-400 uppercase">2. Seleccionar Lote Activo</label>
              <select
                id="select-merma-batch"
                value={selectedBatchId}
                onChange={(e) => {
                  setSelectedBatchId(e.target.value);
                  const selectedB = batches.find(b => b.id === e.target.value);
                  if (selectedB) {
                    setQuantity(selectedB.stock);
                  }
                }}
                disabled={productBatches.length === 0}
                className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100"
              >
                <option value="">
                  {productBatches.length === 0 
                    ? 'No hay lotes de producción activos cargados' 
                    : '-- Elige lote de mostrador --'}
                </option>
                {productBatches.map(b => (
                  <option key={b.id} value={b.id}>
                    Lote: {b.batchNumber} - Disp: {b.stock} u. (Vence: {b.expiryDate})
                  </option>
                ))}
              </select>
              {productBatches.length === 0 && (
                <p className="text-[10px] text-amber-600 font-semibold italic mt-1">
                  Nota: Primero debes registrar un lote activo de este producto en el stock previo.
                </p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <label className="font-extrabold text-[10px] text-gray-400 uppercase">3. Cantidad a dar de baja</label>
                {activeSelectedBatch && (
                  <span className="text-[10px] text-amber-600 font-bold">Max: {activeSelectedBatch.stock} u.</span>
                )}
              </div>
              <input
                id="input-merma-qty"
                type="number"
                min="1"
                max={activeSelectedBatch ? activeSelectedBatch.stock : 9999}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Reason */}
            <div className="space-y-1">
              <label className="font-extrabold text-[10px] text-gray-400 uppercase">4. Motivo / Justificación</label>
              <textarea
                id="input-merma-reason"
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ejemplo: Lote caducó en góndola exhibidora, retirar rancio de la venta."
                className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750 p-2.5 rounded-xl text-zinc-800 dark:text-zinc-150 focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              id="btn-submit-merma"
              disabled={!selectedBatchId}
              className="w-full py-3 bg-red-505 hover:bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer shadow-md disabled:bg-gray-350 disabled:cursor-not-allowed transition-all"
            >
              Enviar Solicitud a Administración ✓
            </button>
          </form>
        </div>

        {/* Right column: Status List */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="font-extrabold text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1.5 leading-none select-none">
            <History className="h-3.5 w-3.5 text-amber-500" /> Monitoreo y Progreso de Solicitudes
          </h3>

          {withdrawalRequests.length === 0 ? (
            <div className="text-center py-10 bg-gray-50/50 dark:bg-zinc-950/20 border border-gray-150 dark:border-zinc-800 rounded-2xl">
              <Clock className="mx-auto h-8 w-8 text-gray-300 dark:text-zinc-700 animate-spin-slow mb-2.5" />
              <p className="text-xs text-gray-400 italic">No hay registros de solicitudes registradas.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {withdrawalRequests.map(req => {
                let statusBadge = "bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-300/20";
                let statusText = "Esperando Aprobación";
                let StatusIcon = Clock;

                if (req.status === 'approved') {
                  statusBadge = "bg-emerald-100 text-emerald-855 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-300/20";
                  statusText = "Aprobado - Baja Efectiva";
                  StatusIcon = CheckCircle2;
                } else if (req.status === 'rejected') {
                  statusBadge = "bg-red-100 text-red-700 dark:bg-red-950/20 dark:text-red-400 border-red-300/20";
                  statusText = "Rechazado - Corregir";
                  StatusIcon = X;
                }

                return (
                  <div
                    key={req.id}
                    className="bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800/80 rounded-2xl p-4 space-y-2.5 shadow-xs transition-transform hover:scale-[1.005]"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        {/* Name / Date */}
                        <div className="flex items-center gap-1.5 select-none">
                          <span className="font-extrabold text-sm text-gray-850 dark:text-zinc-150">{req.productName}</span>
                          <span className="bg-gray-105 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-gray-500">
                            {req.batchNumber}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {new Date(req.date).toLocaleString()} • por <span className="font-semibold text-zinc-400">{req.requestedBy}</span>
                        </div>
                      </div>

                      {/* Status Badges */}
                      <div className={`px-2.5 py-1 rounded-full border text-[9px] font-black uppercase flex items-center gap-1 w-fit ${statusBadge}`}>
                        <StatusIcon className="h-3 w-3 shrink-0" />
                        {statusText}
                      </div>
                    </div>

                    <div className="bg-gray-50/50 dark:bg-zinc-950/40 border border-gray-100 dark:border-zinc-850 p-2.5 rounded-xl text-xs space-y-1">
                      <div>
                        <span className="font-extrabold text-gray-400 block text-[9.5px] uppercase tracking-wider leading-none mb-1">Motivo informado:</span>
                        <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                          Baja solicitada de <span className="font-black text-amber-600 dark:text-amber-500">{req.quantity} unidades</span> por: "{req.reason}"
                        </p>
                      </div>

                      {req.adminMemo && (
                        <div className="pt-2 border-t border-gray-200/50 dark:border-zinc-850/60 mt-1.5">
                          <span className="font-extrabold text-gray-400 block text-[9.5px] uppercase tracking-wider leading-none mb-1">
                            Respuesta de Administración:
                          </span>
                          <p className="font-black text-rose-650 dark:text-amber-400 italic">
                            "{req.adminMemo}"
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
