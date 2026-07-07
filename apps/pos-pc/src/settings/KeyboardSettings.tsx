import { Keyboard } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, PosSettings as PosSettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'pos', values: Partial<PosSettingsType>) => void;
  onSaved: () => void;
}

export const KeyboardSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState<PosSettingsType>({ ...settings.pos });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate('pos', {
      enterAddsToCart: form.enterAddsToCart,
    });
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Keyboard className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Entrada de teclado</h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Tecla Enter en el buscador rápido
          </label>
          <label className="flex items-center gap-3 w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enterAddsToCart}
              onChange={e => setForm(f => ({ ...f, enterAddsToCart: e.target.checked }))}
              className="h-4 w-4 accent-amber-500 cursor-pointer"
            />
            <span className="text-gray-850 dark:text-zinc-100">
              Enter agrega el producto resaltado al carrito
            </span>
          </label>
          <p className="text-[10px] text-gray-400">
            Si está desactivado, Enter en el buscador rápido no agrega nada al carrito. La navegación con
            flechas (arriba/abajo para resaltar, izquierda/derecha para ajustar cantidad) sigue funcionando
            igual; solo se desactiva la acción de confirmar con Enter.
          </p>
        </div>
      </div>

      <div className="pt-2">
        <button
          type="submit"
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          Guardar cambios
        </button>
      </div>
    </form>
  );
};
