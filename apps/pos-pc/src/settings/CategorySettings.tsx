import { Layers, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { CategorySetting } from '../hooks/useSettings';

interface Props {
  categories: CategorySetting[];
  onSave: (categories: CategorySetting[]) => void;
  onSaved: () => void;
}

export const CategorySettings: React.FC<Props> = ({ categories, onSave, onSaved }) => {
  const [items, setItems] = useState<CategorySetting[]>(() => categories ?? []);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('🥖');

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setItems(next.map((c, i) => ({ ...c, sortOrder: i + 1 })));
  };

  const updateItem = (idx: number, patch: Partial<CategorySetting>) => {
    setItems(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    if (!newName.trim()) return;
    const id = `cat_${newName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    setItems(prev => [...prev, { id, name: newName.trim(), icon: newIcon || '🥖', sortOrder: prev.length + 1 }]);
    setNewName('');
    setNewIcon('🥖');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Layers className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Categorías de Productos</h3>
      </div>

      <p className="text-[10px] text-gray-400">
        Gestioná las categorías de productos que aparecen en el POS y en el inventario.
        El orden se respeta en la vista de productos.
      </p>

      <div className="space-y-2">
        {items.map((cat, idx) => (
          <div
            key={cat.id}
            className="flex items-center gap-2 bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3"
          >
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 cursor-pointer">
                <ChevronUp className="h-3 w-3" />
              </button>
              <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 cursor-pointer">
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            <span className="text-xl shrink-0">{cat.icon}</span>

            <input
              type="text"
              value={cat.name}
              onChange={e => updateItem(idx, { name: e.target.value })}
              className="flex-1 text-xs font-bold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-amber-500 outline-none text-gray-800 dark:text-zinc-100 px-1 py-0.5"
            />

            <input
              type="text"
              value={cat.icon}
              onChange={e => updateItem(idx, { icon: e.target.value })}
              className="w-10 text-center text-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-1 py-1 focus:outline-none focus:border-amber-500"
              title="Emoji"
            />

            <button onClick={() => removeItem(idx)} className="p-1 text-gray-400 hover:text-red-500 cursor-pointer shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-3">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nombre de la categoría..."
          className="flex-1 text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 text-gray-850 dark:text-zinc-100"
          onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
        />
        <input
          type="text"
          value={newIcon}
          onChange={e => setNewIcon(e.target.value)}
          placeholder="🥖"
          className="w-12 text-center text-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-2 py-2 focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={addItem}
          disabled={!newName.trim()}
          className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </div>

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
