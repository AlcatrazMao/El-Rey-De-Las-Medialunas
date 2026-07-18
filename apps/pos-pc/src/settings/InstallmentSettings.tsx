import { CreditCard, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { InstallmentConfig } from '../hooks/useSettings';

interface Props {
  installments: InstallmentConfig[];
  onSave: (installments: InstallmentConfig[]) => void;
  onSaved: () => void;
}

const PAYMENT_METHOD_OPTIONS = [
  { id: 'tarjeta', label: 'Tarjeta Crédito' },
  { id: 'qr', label: 'QR / Débito' },
];

export const InstallmentSettings: React.FC<Props> = ({ installments, onSave, onSaved }) => {
  const [items, setItems] = useState<InstallmentConfig[]>(() => installments ?? []);
  const [showForm, setShowForm] = useState(false);
  const [newItem, setNewItem] = useState<{
    label: string;
    installments: number;
    surchargePercent: number;
    paymentMethodId: string;
  }>({
    label: '',
    installments: 1,
    surchargePercent: 0,
    paymentMethodId: 'tarjeta',
  });

  const addItem = () => {
    if (newItem.installments < 1) return;
    const id = `installment_${Date.now()}`;
    setItems(prev => [...prev, {
      id,
      label: newItem.label || `${newItem.installments} cuota${newItem.installments > 1 ? 's' : ''} ${newItem.surchargePercent > 0 ? `(${newItem.surchargePercent}% recargo)` : '(sin interés)'}`,
      installments: newItem.installments,
      surchargePercent: newItem.surchargePercent,
      paymentMethodId: newItem.paymentMethodId,
    }]);
    setNewItem({ label: '', installments: 1, surchargePercent: 0, paymentMethodId: 'tarjeta' });
    setShowForm(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const updateItem = (id: string, patch: Partial<InstallmentConfig>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <CreditCard className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Cuotas / Financiación</h3>
      </div>

      <p className="text-[10px] text-gray-400">
        Configurá las opciones de cuotas ofrecidas al cliente al pagar con QR o Tarjeta.
        Cada cuota puede tener un recargo distinto (ej: 1 cuota sin interés, 3 cuotas con 15% de recargo, 6 cuotas con 25% de recargo).
      </p>

      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-xs font-bold">
            No hay cuotas configuradas. Agregá la primera abajo.
          </div>
        )}
        {items.map((item) => {
          const pmLabel = PAYMENT_METHOD_OPTIONS.find(p => p.id === item.paymentMethodId)?.label ?? item.paymentMethodId;
          return (
            <div
              key={item.id}
              className="bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={item.label}
                    onChange={e => updateItem(item.id, { label: e.target.value })}
                    className="w-full text-sm font-extrabold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-amber-500 outline-none text-gray-800 dark:text-zinc-100"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">{pmLabel}</p>
                </div>
                <button onClick={() => removeItem(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 cursor-pointer shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Cuotas</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={item.installments}
                    onChange={e => updateItem(item.id, { installments: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Recargo %</label>
                  <input
                    type="number"
                    min="0"
                    max="99.99"
                    step="0.01"
                    value={item.surchargePercent}
                    onChange={e => updateItem(item.id, { surchargePercent: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Aplica a</label>
                  <select
                    value={item.paymentMethodId}
                    onChange={e => updateItem(item.id, { paymentMethodId: e.target.value })}
                    className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
                  >
                    {PAYMENT_METHOD_OPTIONS.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-2xl text-xs font-bold transition-colors cursor-pointer w-full justify-center"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar opción de cuotas
        </button>
      ) : (
        <div className="bg-amber-50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-extrabold text-amber-700 dark:text-amber-400">Nueva opción de cuotas</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Label (opcional)</label>
              <input
                type="text"
                value={newItem.label}
                onChange={e => setNewItem(p => ({ ...p, label: e.target.value }))}
                placeholder="Ej: 3 cuotas sin interés"
                className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Aplica a</label>
              <select
                value={newItem.paymentMethodId}
                onChange={e => setNewItem(p => ({ ...p, paymentMethodId: e.target.value }))}
                className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
              >
                {PAYMENT_METHOD_OPTIONS.map(pm => (
                  <option key={pm.id} value={pm.id}>{pm.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Cant. cuotas</label>
              <input
                type="number"
                min="1"
                max="60"
                value={newItem.installments}
                onChange={e => setNewItem(p => ({ ...p, installments: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Recargo %</label>
              <input
                type="number"
                min="0"
                max="99.99"
                step="0.01"
                value={newItem.surchargePercent}
                onChange={e => setNewItem(p => ({ ...p, surchargePercent: parseFloat(e.target.value) || 0 }))}
                className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={addItem}
              disabled={newItem.installments < 1}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Agregar
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-gray-500 dark:text-zinc-400 hover:text-gray-700 text-xs font-bold cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={() => { onSave(items); onSaved(); }}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          Guardar cambios
        </button>
      </div>
    </div>
  );
};
