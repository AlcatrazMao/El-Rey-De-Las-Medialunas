import { AlertTriangle, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import { fetchWithAuth, API_URL } from '../services/api';

const PRESERVED_KEYS = new Set(['pan_erp_settings']);

function isPreservedKey(key: string): boolean {
  if (PRESERVED_KEYS.has(key)) return true;
  if (key.startsWith('pan_erp_widgets_')) return true;
  return false;
}

function wipeLocalStorage(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('pan_erp_') && !isPreservedKey(key)) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}

export const DangerZoneSettings: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleWipe = async () => {
    const confirmed = window.confirm(
      'Esto borrará TODAS las ventas, movimientos, clientes y sesiones de caja. Los productos se conservan. ¿Confirmar?'
    );
    if (!confirmed) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/admin/wipe-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = await res.json() as { success: boolean; data?: { wiped?: string[] }; error?: string };

      if (res.ok && body.success) {
        wipeLocalStorage();
        const count = body.data?.wiped?.length ?? 0;
        setResult({ ok: true, message: `Vaciado completado. Se limpiaron ${count} tablas y los datos locales.` });
      } else {
        const msg = typeof body.error === 'string' ? body.error : `Error ${res.status}`;
        setResult({ ok: false, message: msg });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Error de red';
      setResult({ ok: false, message: detail });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <AlertTriangle className="h-4 w-4 text-red-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Sistema</h3>
      </div>

      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-extrabold text-red-700 dark:text-red-400">Zona de Peligro</p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-1">
              Las acciones de esta sección son irreversibles. Usalas solo en entornos de prueba.
            </p>
          </div>
        </div>

        <div className="border-t border-red-200 dark:border-red-900/50 pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold text-gray-800 dark:text-zinc-100">Vaciar datos de prueba</p>
            <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
              Borra ventas, movimientos de stock, sesiones de caja, clientes, gastos y producción. El catálogo de productos se conserva.
            </p>
          </div>
          <button
            type="button"
            onClick={handleWipe}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {loading ? 'Vaciando...' : 'Vaciar datos de prueba'}
          </button>
        </div>

        {result && (
          <div
            className={`rounded-lg px-4 py-2.5 text-xs font-semibold ${
              result.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                : 'bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400'
            }`}
          >
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
};
