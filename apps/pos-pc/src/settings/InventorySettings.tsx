import { Package } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, InventorySettings as InventorySettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'inventory', values: Partial<InventorySettingsType>) => void;
  onSaved: () => void;
}

export const InventorySettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState<InventorySettingsType>({ ...settings.inventory });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate('inventory', form);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Package className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Configuración de Inventario</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Días de Anticipación — Alerta de Caducidad
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.expiryAlertDays}
            onChange={e => setForm(f => ({ ...f, expiryAlertDays: Number(e.target.value) }))}
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
          <p className="text-[10px] text-gray-400">
            Alertar cuando un lote venza en este plazo o menos.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Umbral Global de Stock Mínimo
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.globalLowStockThreshold}
            onChange={e => setForm(f => ({ ...f, globalLowStockThreshold: Number(e.target.value) }))}
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
          <p className="text-[10px] text-gray-400">
            0 = usar el umbral configurado por producto individualmente.
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
