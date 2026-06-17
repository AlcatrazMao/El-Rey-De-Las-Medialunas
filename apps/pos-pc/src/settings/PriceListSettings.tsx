import { Tag, Star } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, PriceList, CustomerTypeKey } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (priceLists: PriceList[]) => void;
  onSaved: () => void;
}

const CUSTOMER_TYPE_LABELS: Record<CustomerTypeKey, string> = {
  consumidor_final: 'Consumidor Final',
  frecuente: 'Cliente Frecuente',
  mayorista: 'Mayorista',
  empresa: 'Empresa / B2B',
};

const MAX_LISTS = 3;

export const PriceListSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [lists, setLists] = useState<PriceList[]>(settings.priceLists);

  const handleChange = (id: string, field: keyof PriceList, value: unknown) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const handleToggleCustomerType = (listId: string, type: CustomerTypeKey) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l;
      const has = l.customerTypes.includes(type);
      return { ...l, customerTypes: has ? l.customerTypes.filter(t => t !== type) : [...l.customerTypes, type] };
    }));
  };

  const handleSetDefault = (id: string) => {
    setLists(prev => prev.map(l => ({ ...l, isDefault: l.id === id })));
  };

  const handleAdd = () => {
    if (lists.length >= MAX_LISTS) return;
    const newId = `list_${Date.now().toString(36)}`;
    setLists(prev => [...prev, { id: newId, name: `Lista ${prev.length + 1}`, discountPercent: 0, customerTypes: [], isDefault: false }]);
  };

  const handleRemove = (id: string) => {
    if (lists.length <= 1) return;
    setLists(prev => {
      const next = prev.filter(l => l.id !== id);
      if (!next.some(l => l.isDefault)) next[0].isDefault = true;
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(lists);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-4">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Listas de Precios</h3>
        </div>
        {lists.length < MAX_LISTS && (
          <button
            type="button"
            onClick={handleAdd}
            className="text-[10px] font-bold px-3 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-lg cursor-pointer transition-all"
          >
            + Agregar lista
          </button>
        )}
      </div>

      <p className="text-[11px] text-gray-400">
        Definí hasta {MAX_LISTS} listas. El descuento es sobre el precio de lista del artículo
        (valor negativo = descuento, positivo = recargo).
      </p>

      <div className="space-y-4">
        {lists.map(list => (
          <div
            key={list.id}
            className={`border rounded-2xl p-4 space-y-4 transition-all ${
              list.isDefault
                ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10'
                : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-850'
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {list.isDefault && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                <input
                  type="text"
                  value={list.name}
                  onChange={e => handleChange(list.id, 'name', e.target.value)}
                  maxLength={24}
                  className="text-sm font-extrabold bg-transparent border-b border-dashed border-gray-300 dark:border-zinc-600 focus:outline-none focus:border-amber-500 text-gray-800 dark:text-zinc-100 w-40"
                  placeholder="Nombre de la lista"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {!list.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(list.id)}
                    className="text-[10px] font-bold text-gray-400 hover:text-amber-600 cursor-pointer transition-colors"
                    title="Marcar como lista predeterminada"
                  >
                    Establecer por defecto
                  </button>
                )}
                {lists.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemove(list.id)}
                    className="text-[10px] font-bold text-red-400 hover:text-red-600 cursor-pointer transition-colors"
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                  Descuento / Recargo (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="-100"
                    max="200"
                    step="0.5"
                    value={list.discountPercent}
                    onChange={e => handleChange(list.id, 'discountPercent', parseFloat(e.target.value) || 0)}
                    className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 pr-8 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                  />
                  <span className="absolute right-3 top-3 text-xs text-gray-400 font-bold">%</span>
                </div>
                <p className="text-[10px] text-gray-400">
                  {list.discountPercent < 0
                    ? `Descuento del ${Math.abs(list.discountPercent)}% sobre precio base`
                    : list.discountPercent > 0
                    ? `Recargo del ${list.discountPercent}% sobre precio base`
                    : 'Sin modificación — precio base'}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                  Tipos de cliente asignados
                </label>
                <div className="space-y-1.5">
                  {(Object.entries(CUSTOMER_TYPE_LABELS) as [CustomerTypeKey, string][]).map(([type, label]) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={list.customerTypes.includes(type)}
                        onChange={() => handleToggleCustomerType(list.id, type)}
                        className="rounded text-amber-500 border-gray-300 focus:ring-amber-500 h-3.5 w-3.5"
                      />
                      <span className="text-[11px] font-semibold text-gray-700 dark:text-zinc-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          Guardar listas de precios
        </button>
      </div>
    </form>
  );
};
