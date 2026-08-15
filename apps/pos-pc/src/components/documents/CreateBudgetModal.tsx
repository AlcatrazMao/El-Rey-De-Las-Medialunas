import { Plus, X, Loader2, Trash2, FileText } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { useApp } from '../../AppContext';
import type { BudgetItemInput, BudgetResult } from '../../hooks/useDocuments';
import type { DocumentPrintItem } from '../../utils/exportUtils';

// Sigue el patrón visual de components/transfers/CreateTransferModal.tsx.

interface BudgetLineDraft {
  product_id: string;
  quantity: number;
  unit_price: number;
}

function defaultValidUntil(days = 15): string {
  // Default a `days` días — personalizable vía `presupuesto_valid_days`
  // (Configuración → Comprobantes). Formato YYYY-MM-DD (input date).
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const CreateBudgetModal: React.FC<{
  onClose: () => void;
  onCreate: (payload: { customer_id?: string; items: BudgetItemInput[]; valid_until: string }) => Promise<{ ok: boolean; data?: BudgetResult; error?: string }>;
  /** `printItems`: detalle resuelto (nombre real de producto) para poder imprimir sin volver a pegarle al backend. */
  onCreated: (result: BudgetResult, printItems: DocumentPrintItem[], customerName?: string) => void;
  /** Días de validez default del presupuesto (presupuesto_valid_days). Default 15. */
  defaultValidDays?: number;
}> = ({ onClose, onCreate, onCreated, defaultValidDays }) => {
  const { products = [], customers = [] } = useApp();

  const [customerId, setCustomerId] = useState('');
  const [validUntil, setValidUntil] = useState(defaultValidUntil(defaultValidDays));
  const [items, setItems] = useState<BudgetLineDraft[]>([
    { product_id: products[0]?.id ?? '', quantity: 1, unit_price: products[0]?.price ?? 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addItem = () => setItems(prev => [...prev, { product_id: products[0]?.id ?? '', quantity: 1, unit_price: products[0]?.price ?? 0 }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<BudgetLineDraft>) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Al elegir un producto, prellenamos el precio unitario con el de catálogo
  // (el operador puede pisarlo manualmente después — un presupuesto puede
  // cotizar a un precio distinto del de venta actual).
  const selectProduct = (idx: number, productId: string) => {
    const product = products.find(p => p.id === productId);
    updateItem(idx, { product_id: productId, unit_price: product?.price ?? 0 });
  };

  const total = useMemo(
    () => items.reduce((acc, it) => acc + (it.quantity > 0 ? it.quantity * it.unit_price : 0), 0),
    [items],
  );

  const submit = async () => {
    setErr(null);
    if (!validUntil) { setErr('Elegí una fecha de validez'); return; }
    const validItems = items.filter(it => it.product_id && it.quantity > 0 && it.unit_price >= 0);
    if (validItems.length === 0) { setErr('Agregá al menos un producto con cantidad válida'); return; }

    setSubmitting(true);
    const result = await onCreate({
      customer_id: customerId || undefined,
      items: validItems,
      valid_until: validUntil,
    });
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setErr(result.error ?? 'No se pudo crear el presupuesto');
      return;
    }
    const printItems: DocumentPrintItem[] = validItems.map(it => ({
      name: products.find(p => p.id === it.product_id)?.name || it.product_id,
      quantity: it.quantity,
      price: it.unit_price,
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
            <FileText className="h-4 w-4 text-amber-500" /> Nuevo presupuesto
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
          El presupuesto es una cotización: no afecta stock ni caja.
        </p>

        <div className="grid grid-cols-2 gap-2">
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
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Válido hasta</span>
            <input
              type="date"
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
            />
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Productos</span>
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={item.product_id}
                onChange={e => selectProduct(idx, e.target.value)}
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
                className="w-16 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                title="Cantidad"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.unit_price}
                onChange={e => updateItem(idx, { unit_price: Number(e.target.value) })}
                className="w-24 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                title="Precio unitario"
              />
              <span className="text-xs text-gray-500 dark:text-zinc-400 w-20 text-right">
                ${(item.quantity * item.unit_price).toFixed(2)}
              </span>
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

        <div className="flex items-center justify-between px-1 py-2 border-t border-gray-100 dark:border-zinc-800">
          <span className="text-sm font-bold text-gray-700 dark:text-zinc-300">Total estimado</span>
          <span className="text-lg font-black text-amber-600">${total.toFixed(2)}</span>
        </div>

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
            Crear presupuesto
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateBudgetModal;
