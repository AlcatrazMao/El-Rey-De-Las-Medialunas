import { Receipt } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, FiscalSettings as FiscalSettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'fiscal', values: Partial<FiscalSettingsType>) => void;
  onSaved: () => void;
}

export const FiscalSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState({
    ivaPercent: String(Math.round(settings.fiscal.ivaRate * 100)),
    fiscalRegime: settings.fiscal.fiscalRegime,
    currency: settings.fiscal.currency,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ivaRate = parseFloat(form.ivaPercent) / 100;
    onUpdate('fiscal', {
      ivaRate: isNaN(ivaRate) ? 0.21 : ivaRate,
      fiscalRegime: form.fiscalRegime,
      currency: form.currency,
    });
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Receipt className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Configuración Fiscal</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Alícuota de IVA (%)
          </label>
          <div className="relative">
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={form.ivaPercent}
              onChange={e => setForm(f => ({ ...f, ivaPercent: e.target.value }))}
              className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 pr-8 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
            />
            <span className="absolute right-3 top-3 text-xs text-gray-400 font-bold">%</span>
          </div>
          <p className="text-[10px] text-gray-400">Se guardará como decimal (ej: 21% → 0.21)</p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Moneda</label>
          <select
            value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value as 'ARS' | 'USD' }))}
            className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
          >
            <option value="ARS">🇦🇷 ARS — Peso Argentino</option>
            <option value="USD">🇺🇸 USD — Dólar Estadounidense</option>
          </select>
        </div>

        <div className="sm:col-span-2 space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Régimen Fiscal</label>
          <select
            value={form.fiscalRegime}
            onChange={e => setForm(f => ({ ...f, fiscalRegime: e.target.value as FiscalSettingsType['fiscalRegime'] }))}
            className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none text-gray-850 dark:text-zinc-100"
          >
            <option value="responsable_inscripto">Responsable Inscripto</option>
            <option value="monotributista">Monotributista</option>
            <option value="exento">Exento</option>
          </select>
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
