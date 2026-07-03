import { Printer } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import type { AppSettings, PrinterSettings as PrinterSettingsType } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (section: 'printer', values: Partial<PrinterSettingsType>) => void;
  onSaved: () => void;
}

export const PrinterSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const [form, setForm] = useState<PrinterSettingsType>({ ...settings.printer });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate('printer', {
      useBridge: form.useBridge,
      bridgeUrl: form.bridgeUrl.trim() || 'http://localhost:9100',
      autoPrint: form.autoPrint,
    });
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Printer className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Impresora Térmica</h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Impresión directa
          </label>
          <label className="flex items-center gap-3 w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.useBridge}
              onChange={e => setForm(f => ({ ...f, useBridge: e.target.checked }))}
              className="h-4 w-4 accent-amber-500 cursor-pointer"
            />
            <span className="text-gray-850 dark:text-zinc-100">
              Usar impresión directa (bridge local)
            </span>
          </label>
          <p className="text-[10px] text-gray-400">
            Envía el ticket a un servicio local instalado en esta PC que imprime directo a la impresora
            térmica, sin pasar por el diálogo de impresión del navegador. Si el servicio no responde,
            se usa automáticamente el método habitual (diálogo de impresión del navegador).
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            URL del bridge local
          </label>
          <input
            type="text"
            value={form.bridgeUrl}
            onChange={e => setForm(f => ({ ...f, bridgeUrl: e.target.value }))}
            disabled={!form.useBridge}
            placeholder="http://localhost:9100"
            className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="text-[10px] text-gray-400">
            Dirección donde escucha el servicio de impresión local (por defecto http://localhost:9100).
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Impresión automática
          </label>
          <label className="flex items-center gap-3 w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.autoPrint}
              onChange={e => setForm(f => ({ ...f, autoPrint: e.target.checked }))}
              className="h-4 w-4 accent-amber-500 cursor-pointer"
            />
            <span className="text-gray-850 dark:text-zinc-100">
              Auto-imprimir al cerrar venta
            </span>
          </label>
          <p className="text-[10px] text-gray-400">
            Si está desactivado, el comprobante no se imprime solo: al completar la venta se muestra
            el modal con botones para imprimir, exportar o simplemente cerrar.
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
