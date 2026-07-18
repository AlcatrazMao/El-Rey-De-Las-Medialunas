import { Plus, X, Loader2, Trash2 } from 'lucide-react';
import React, { useState } from 'react';

import { useApp } from '../../AppContext';

// Sigue el patrón visual de components/requests/CreateRequestModal.tsx: mismo
// overlay, mismo shell de card, mismos estilos de input/botón — reusa la UI
// existente en vez de inventar un modal nuevo.

interface TransferItemDraft {
  product_id: string;
  quantity: number;
}

export const CreateTransferModal: React.FC<{
  /** Sucursales que puede elegir como origen (roles elevados; operativos quedan fijos en la propia). */
  branches: { id: string; name?: string }[];
  /** Prefill opcional (viene de una recomendación del Dashboard). */
  prefill?: { productId: string; quantity: number; fromBranchId: string; toBranchId: string };
  onClose: () => void;
  onCreate: (payload: {
    source_branch_id?: string;
    destination_branch_id: string;
    notes?: string;
    items: { product_id: string; quantity: number }[];
  }) => Promise<{ ok: boolean; error?: string }>;
  onCreated: () => void;
}> = ({ branches, prefill, onClose, onCreate, onCreated }) => {
  const { products = [], canSelectBranch } = useApp();

  const [sourceBranchId, setSourceBranchId] = useState(prefill?.fromBranchId ?? '');
  const [destinationBranchId, setDestinationBranchId] = useState(prefill?.toBranchId ?? '');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<TransferItemDraft[]>(
    prefill ? [{ product_id: prefill.productId, quantity: prefill.quantity }] : [{ product_id: products[0]?.id ?? '', quantity: 1 }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addItem = () => setItems(prev => [...prev, { product_id: products[0]?.id ?? '', quantity: 1 }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<TransferItemDraft>) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const submit = async () => {
    setErr(null);
    if (!destinationBranchId) { setErr('Elegí la sucursal de destino'); return; }
    if (canSelectBranch && !sourceBranchId) { setErr('Elegí la sucursal de origen'); return; }
    if (destinationBranchId === sourceBranchId) { setErr('Origen y destino no pueden ser la misma sucursal'); return; }
    const validItems = items.filter(it => it.product_id && it.quantity > 0);
    if (validItems.length === 0) { setErr('Agregá al menos un producto con cantidad válida'); return; }

    setSubmitting(true);
    const result = await onCreate({
      source_branch_id: canSelectBranch ? sourceBranchId : undefined,
      destination_branch_id: destinationBranchId,
      notes: notes.trim() || undefined,
      items: validItems,
    });
    setSubmitting(false);
    if (!result.ok) {
      setErr(result.error ?? 'No se pudo crear el traslado');
      return;
    }
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Plus className="h-4 w-4 text-amber-500" /> Nuevo traslado
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
          El traslado queda pendiente de aprobación. Al aprobarse se genera automáticamente una entrega para el chofer.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {canSelectBranch && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Origen</span>
              <select
                value={sourceBranchId}
                onChange={e => setSourceBranchId(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              >
                <option value="">— Elegir —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name ?? b.id}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Destino</span>
            <select
              value={destinationBranchId}
              onChange={e => setDestinationBranchId(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
            >
              <option value="">— Elegir —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name ?? b.id}</option>)}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Productos</span>
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={item.product_id}
                onChange={e => updateItem(idx, { product_id: e.target.value })}
                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              >
                <option value="" disabled>Seleccionar artículo…</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.image} {p.name}</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={item.quantity}
                onChange={e => updateItem(idx, { quantity: Number(e.target.value) })}
                className="w-20 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              />
              <button
                onClick={() => removeItem(idx)}
                disabled={items.length <= 1}
                className="text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            onClick={addItem}
            className="text-xs font-bold text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Agregar producto
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Notas (opcional)</span>
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            placeholder="Detalle opcional..."
          />
        </label>

        {err && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded px-2 py-1">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={submitting}
            className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Crear traslado
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateTransferModal;
