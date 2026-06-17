import { Percent, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, Promotion, PromotionType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (promotions: Promotion[]) => void;
  onSaved: () => void;
}

const CATEGORIES = ['todos', 'panes', 'facturas', 'pasteleria', 'salados', 'bebidas'];
const CATEGORY_LABELS: Record<string, string> = {
  todos: 'Todos los productos',
  panes: 'Panes',
  facturas: 'Facturas / Dulces',
  pasteleria: 'Repostería',
  salados: 'Salados',
  bebidas: 'Bebidas',
};
const EMPTY_PROMO: Omit<Promotion, 'id'> = {
  name: '',
  type: 'quantity_discount',
  minQuantity: 3,
  discountPercent: 10,
  applicableCategories: ['todos'],
  active: true,
};

export const PromotionsSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [promotions, setPromotions] = useState<Promotion[]>(settings.promotions);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<Promotion, 'id'>>(EMPTY_PROMO);

  const handleToggleActive = (id: string) => {
    setPromotions(prev => prev.map(p => p.id === id ? { ...p, active: !p.active } : p));
  };

  const handleRemove = (id: string) => {
    setPromotions(prev => prev.filter(p => p.id !== id));
  };

  const handleToggleCategory = (cat: string) => {
    setForm(f => {
      if (cat === 'todos') return { ...f, applicableCategories: ['todos'] };
      const without = f.applicableCategories.filter(c => c !== 'todos');
      const has = without.includes(cat);
      const next = has ? without.filter(c => c !== cat) : [...without, cat];
      return { ...f, applicableCategories: next.length === 0 ? ['todos'] : next };
    });
  };

  const handleAddPromo = () => {
    if (!form.name.trim()) return;
    const newPromo: Promotion = { ...form, id: `promo_${Date.now().toString(36)}` };
    setPromotions(prev => [...prev, newPromo]);
    setForm(EMPTY_PROMO);
    setShowForm(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(promotions);
    onSaved();
  };

  const typeLabel: Record<PromotionType, string> = {
    quantity_discount: 'Descuento por cantidad',
    fixed_discount: 'Descuento directo',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-4">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Promociones</h3>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-lg cursor-pointer transition-all"
          >
            <Plus className="h-3 w-3" /> Nueva promoción
          </button>
        )}
      </div>

      <p className="text-[11px] text-gray-400">
        Las promociones se muestran en el POS al agregar productos que cumplen las condiciones.
      </p>

      {/* Add promotion form */}
      {showForm && (
        <div className="border border-amber-200 dark:border-amber-800 bg-amber-50/20 dark:bg-amber-950/10 rounded-2xl p-4 space-y-4">
          <p className="text-[11px] font-extrabold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Nueva Promoción</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Nombre</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: 3x2 en medialunas"
                maxLength={48}
                className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Tipo</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as PromotionType }))}
                className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
              >
                <option value="quantity_discount">Descuento por cantidad mínima</option>
                <option value="fixed_discount">Descuento directo (siempre)</option>
              </select>
            </div>

            {form.type === 'quantity_discount' && (
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Cantidad mínima</label>
                <input
                  type="number"
                  min="2"
                  max="100"
                  value={form.minQuantity}
                  onChange={e => setForm(f => ({ ...f, minQuantity: parseInt(e.target.value) || 2 }))}
                  className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Descuento (%)</label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="0.5"
                  value={form.discountPercent}
                  onChange={e => setForm(f => ({ ...f, discountPercent: parseFloat(e.target.value) || 0 }))}
                  className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 pr-8 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                />
                <span className="absolute right-3 top-3 text-xs text-gray-400 font-bold">%</span>
              </div>
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Aplica a categorías</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleToggleCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold cursor-pointer transition-all border ${
                      form.applicableCategories.includes(cat)
                        ? 'bg-amber-500 text-white border-amber-600'
                        : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700 hover:border-amber-300'
                    }`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleAddPromo}
              disabled={!form.name.trim()}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Agregar promoción
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(EMPTY_PROMO); }}
              className="px-4 py-2.5 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-700 text-gray-500 dark:text-zinc-400 hover:text-gray-700 rounded-xl cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Promotions list */}
      {promotions.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-xs font-semibold border border-dashed border-gray-200 dark:border-zinc-700 rounded-2xl">
          No hay promociones configuradas. Agregá una para activarla en el POS.
        </div>
      ) : (
        <div className="space-y-3">
          {promotions.map(promo => (
            <div
              key={promo.id}
              className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                promo.active
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/20 dark:bg-emerald-950/10'
                  : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-850 opacity-60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-extrabold text-gray-800 dark:text-zinc-100 truncate">{promo.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {typeLabel[promo.type]}
                  {promo.type === 'quantity_discount' && ` · mín. ${promo.minQuantity} u.`}
                  {' · '}{promo.discountPercent}% off
                  {' · '}{promo.applicableCategories.includes('todos') ? 'Todos' : promo.applicableCategories.join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggleActive(promo.id)}
                  className="text-gray-400 hover:text-emerald-500 cursor-pointer transition-colors"
                  title={promo.active ? 'Desactivar' : 'Activar'}
                >
                  {promo.active
                    ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                    : <ToggleLeft className="h-5 w-5" />
                  }
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(promo.id)}
                  className="text-gray-300 hover:text-red-500 cursor-pointer transition-colors"
                  title="Eliminar promoción"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2">
        <button
          type="submit"
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          Guardar promociones
        </button>
      </div>
    </form>
  );
};
