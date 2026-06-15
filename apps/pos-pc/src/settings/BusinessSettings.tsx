import { Building2 } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, BusinessSettings as BusinessSettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'business', values: Partial<BusinessSettingsType>) => void;
  onSaved: () => void;
}

export const BusinessSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState<BusinessSettingsType>({ ...settings.business });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate('business', form);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Building2 className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Datos del Negocio</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Nombre del Negocio</label>
          <input
            type="text"
            value={form.businessName}
            onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
            placeholder="El Rey de las Medialunas"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">CUIT / RUT</label>
          <input
            type="text"
            value={form.cuit}
            onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
            placeholder="20-12345678-9"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Teléfono</label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="+54 11 4123-4567"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
        </div>

        <div className="sm:col-span-2 space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Dirección</label>
          <input
            type="text"
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            placeholder="Av. Corrientes 1234, CABA"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
        </div>

        <div className="sm:col-span-2 space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Email Empresarial</label>
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="admin@panaderia.com"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
        </div>

        <div className="sm:col-span-2 space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">ID de Sucursal</label>
          <input
            type="text"
            value={form.branchId}
            onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}
            placeholder="00000000000000000000000000000001"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 font-mono"
          />
          <p className="text-[10px] text-gray-400">Se usa en todas las sincronizaciones con la base de datos. Cambiarlo solo si tenés múltiples sucursales.</p>
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
