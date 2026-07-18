import { Plus, X, Loader2, Trash2, Truck } from 'lucide-react';
import React, { useState } from 'react';

import { useApp } from '../../AppContext';
import type { RemitoItemInput, RemitoResult } from '../../hooks/useDocuments';
import type { DocumentPrintItem } from '../../utils/exportUtils';

// Sigue el patrón visual de components/transfers/CreateTransferModal.tsx: mismo
// overlay, mismo shell de card, mismos estilos de input/botón.

interface RemitoLineDraft {
  product_id: string;
  quantity: number;
  description: string;
}

export const CreateRemitoModal: React.FC<{
  onClose: () => void;
  onCreate: (payload: { customer_id?: string; items: RemitoItemInput[]; notes?: string }) => Promise<{ ok: boolean; data?: RemitoResult; error?: string }>;
  /** `printItems`: detalle resuelto (nombre real de producto) para poder imprimir sin volver a pegarle al backend. */
  onCreated: (result: RemitoResult, printItems: DocumentPrintItem[], customerName?: string) => void;
}> = ({ onClose, onCreate, onCreated }) => {
  const { products = [], customers = [] } = useApp();

  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<RemitoLineDraft[]>([{ product_id: products[0]?.id ?? '', quantity: 1, description: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addItem = () => setItems(prev => [...prev, { product_id: products[0]?.id ?? '', quantity: 1, description: '' }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<RemitoLineDraft>) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const submit = async () => {
    setErr(null);
    const validItems = items.filter(it => it.product_id && it.quantity > 0);
    if (validItems.length === 0) { setErr('Agregá al menos un producto con cantidad válida'); return; }

    setSubmitting(true);
    const result = await onCreate({
      customer_id: customerId || undefined,
      items: validItems.map(it => ({
        product_id: it.product_id,
        quantity: it.quantity,
        description: it.description.trim() || undefined,
      })),
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setErr(result.error ?? 'No se pudo crear el remito');
      return;
    }
    const printItems: DocumentPrintItem[] = validItems.map(it => ({
      name: it.description.trim() || products.find(p => p.id === it.product_id)?.name || it.product_id,
      quantity: it.quantity,
      price: 0,
    }));
    const customerName = customerId ? customers.find(c => c.id === customerId)?.name : undefined;
    onCreated(result.data, printItems, customerName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Truck className="h-4 w-4 text-amber-500" /> Nuevo remito
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
          El remito solo documenta traslado de mercadería: no incluye precios, IVA ni total, y no afecta stock ni caja.
        </p>

        <label className="block">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Cliente (opcional)</span>
          <select
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
          >
            <option value="">— Consumidor final —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Productos</span>
          {items.map((item, idx) => (
            <div key={idx} className="flex flex-col gap-1.5 border border-gray-100 dark:border-zinc-800 rounded-lg p-2">
              <div className="flex items-center gap-2">
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
              <input
                type="text"
                placeholder="Descripción opcional de la línea…"
                value={item.description}
                onChange={e => updateItem(idx, { description: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              />
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
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Notas generales (opcional)</span>
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
            Crear remito
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateRemitoModal;
