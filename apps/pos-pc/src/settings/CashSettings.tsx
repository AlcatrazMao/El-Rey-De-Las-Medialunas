import { Banknote, Plus, Wallet, X } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, CashSettings as CashSettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'cash', values: Partial<CashSettingsType>) => void;
  onSaved: () => void;
}

const PRESET_DENOMS = [10, 20, 50, 100, 200, 500, 1000, 2000, 10000];

export const CashSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState<CashSettingsType>({
    ...settings.cash,
    denominaciones: settings.cash.denominaciones ?? [100, 200, 500, 1000, 2000, 10000],
  });
  const [customDenom, setCustomDenom] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate('cash', form);
    onSaved();
  };

  const handleAddCustom = () => {
    const val = parseInt(customDenom, 10);
    if (!val || val <= 0 || form.denominaciones.includes(val)) return;
    setForm(f => ({ ...f, denominaciones: [...f.denominaciones, val].sort((a, b) => a - b) }));
    setCustomDenom('');
  };

  const customDenoms = form.denominaciones.filter(d => !PRESET_DENOMS.includes(d));

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
          <h3 className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-1">Denominaciones activas</h3>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3">
            Seleccioná los billetes del arqueo. Podés agregar denominaciones adicionales si es necesario.
          </p>

          {/* Presets ARS */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {PRESET_DENOMS.map(bil => {
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
                  className={`py-2 px-1 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-amber-500 text-white border-amber-600'
                      : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700 hover:border-amber-400'
                  }`}
                >
                  ${bil >= 1000 ? `${(bil / 1000).toLocaleString('es-AR')}k` : bil}
                </button>
              );
            })}
          </div>

          {/* Denominaciones custom activas */}
          {customDenoms.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {customDenoms.map(d => (
                <span
                  key={d}
                  className="flex items-center gap-1 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-gray-700 dark:text-zinc-200"
                >
                  ${d.toLocaleString('es-AR')}
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, denominaciones: f.denominaciones.filter(x => x !== d) }))}
                    className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Agregar denominación custom */}
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min="1"
              step="1"
              value={customDenom}
              onChange={e => setCustomDenom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustom(); } }}
              placeholder="Agregar otra denominación..."
              className="flex-1 text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 placeholder:text-gray-350 dark:placeholder:text-zinc-600"
            />
            <button
              type="button"
              onClick={handleAddCustom}
              disabled={!customDenom || parseInt(customDenom, 10) <= 0}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 border border-zinc-200 dark:border-zinc-700 hover:border-amber-400 rounded-xl text-xs font-bold text-gray-600 dark:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar
            </button>
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
