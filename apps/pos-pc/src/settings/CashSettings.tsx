import { Banknote, Wallet } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, CashSettings as CashSettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'cash', values: Partial<CashSettingsType>) => void;
  onSaved: () => void;
}

export const CashSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState<CashSettingsType>({
    ...settings.cash,
    denominaciones: settings.cash.denominaciones ?? [10, 20, 50, 100, 1000, 2000, 10000, 20000],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate('cash', form);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Wallet className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Configuración de Caja</h3>
      </div>

      <div className="space-y-4">

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block mb-2">
            Modo de Apertura por Defecto
          </label>
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-zinc-800 p-0.5 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, defaultOpeningMode: 'manual' }))}
              className={`text-xs font-bold py-1.5 px-4 rounded-md transition-all cursor-pointer ${form.defaultOpeningMode === 'manual' ? 'bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600'}`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, defaultOpeningMode: 'billetes' }))}
              className={`text-xs font-bold py-1.5 px-4 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${form.defaultOpeningMode === 'billetes' ? 'bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600'}`}
            >
              <Banknote className="w-3.5 h-3.5" />
              Billetes
            </button>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-1">
            {form.defaultOpeningMode === 'billetes'
              ? 'El monto de apertura se calcula automáticamente desde el contador de billetes.'
              : 'El monto de apertura se ingresa manualmente en cada apertura.'}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Monto de Apertura por Defecto ($)
          </label>
          <input
            type="number"
            min="0"
            step="100"
            value={form.defaultOpeningAmount}
            onChange={e => setForm(f => ({ ...f, defaultOpeningAmount: Number(e.target.value) }))}
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Nota de Apertura por Defecto
          </label>
          <textarea
            rows={3}
            value={form.defaultOpeningNote}
            onChange={e => setForm(f => ({ ...f, defaultOpeningNote: e.target.value }))}
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 resize-none"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Nota de Cierre por Defecto
          </label>
          <textarea
            rows={3}
            value={form.defaultClosingNote}
            onChange={e => setForm(f => ({ ...f, defaultClosingNote: e.target.value }))}
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 resize-none"
          />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-3">Denominaciones activas</h3>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3">
            Seleccioná los billetes que querés usar en el arqueo de caja.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {[10, 20, 50, 100, 1000, 2000, 10000, 20000].map(bil => {
              const active = form.denominaciones.includes(bil);
              return (
                <button
                  key={bil}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? form.denominaciones.filter(d => d !== bil)
                      : [...form.denominaciones, bil].sort((a, b) => a - b);
                    setForm(f => ({ ...f, denominaciones: next }));
                  }}
                  className={`py-2 px-1 rounded-xl border text-xs font-bold transition-colors ${
                    active
                      ? 'bg-amber-500 text-white border-amber-600'
                      : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
                  }`}
                >
                  ${bil >= 1000 ? `${bil / 1000}k` : bil}
                </button>
              );
            })}
          </div>
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
