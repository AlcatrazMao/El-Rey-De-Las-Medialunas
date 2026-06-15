import { Printer } from 'lucide-react';
import * as React from 'react';

export const PrinterSettings: React.FC = () => {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <Printer className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Impresora Térmica</h3>
        <span className="ml-auto text-[10px] font-black bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2.5 py-1 rounded-full uppercase tracking-wider">
          En desarrollo
        </span>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/15 border border-amber-200/60 dark:border-amber-800/30 rounded-2xl p-5 text-center space-y-2">
        <Printer className="h-8 w-8 text-amber-400 mx-auto opacity-50" />
        <p className="text-xs font-extrabold text-amber-700 dark:text-amber-400">
          Configuración de impresora térmica — Próximamente disponible
        </p>
        <p className="text-[10px] text-amber-600/70 dark:text-amber-500/60">
          Esta sección permitirá configurar impresoras para tickets y comprobantes de caja.
        </p>
      </div>

      <div className="space-y-4 opacity-50 pointer-events-none select-none">
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Tipo de Conexión
          </label>
          <select
            disabled
            className="w-full text-xs font-bold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 text-gray-400 dark:text-zinc-600 cursor-not-allowed"
          >
            <option value="usb">USB</option>
            <option value="com">Puerto COM (Serial)</option>
            <option value="network">Red (TCP/IP)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
              IP / Host
            </label>
            <input
              type="text"
              disabled
              placeholder="192.168.1.100"
              className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 text-gray-300 dark:text-zinc-600 cursor-not-allowed"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
              Puerto
            </label>
            <input
              type="number"
              disabled
              placeholder="9100"
              className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 text-gray-300 dark:text-zinc-600 cursor-not-allowed"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
