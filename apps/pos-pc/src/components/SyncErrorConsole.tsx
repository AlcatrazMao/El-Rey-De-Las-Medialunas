import { AlertCircle, RefreshCw, Edit3, Save, X, ShieldAlert } from 'lucide-react';
import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';

import { useApp } from '../AppContext';
import { syncErrorStore, type IDBSyncError } from '../lib/idb';
import type { SyncErrorCategory } from '../types';

const CATEGORY_BADGE: Record<SyncErrorCategory, { bg: string; label: string }> = {
  network: { bg: 'bg-gray-500', label: 'Red' },
  auth: { bg: 'bg-blue-500', label: 'Auth' },
  validation: { bg: 'bg-orange-500', label: 'Validación' },
  server: { bg: 'bg-red-500', label: 'Servidor' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

interface PayloadShape {
  customer_id?: string | null;
  branch_id?: string | null;
  [k: string]: unknown;
}

export const SyncErrorConsole: React.FC = () => {
  const { activeUser, retryError, retryAllNetwork, addSystemNotification } = useApp();
  const [errors, setErrors] = useState<IDBSyncError[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ customer_id: string; branch_id: string }>({
    customer_id: '',
    branch_id: '',
  });
  const [loading, setLoading] = useState(false);

  // NOTE: el plan original menciona role === 'owner', pero el sistema no tiene
  // ese rol — solo 'admin' tiene acceso a la consola de errores de sync.
  const isAdmin = activeUser?.role === 'admin';

  const reload = useCallback(async () => {
    try {
      const all = await syncErrorStore.getPending();
      // Orden: created_at desc
      all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      setErrors(all);
    } catch (err) {
      // ignore
      void err;
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => { void reload(); }, 5_000);
    return () => clearInterval(id);
  }, [reload]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-3 bg-red-50/30 dark:bg-red-950/10 border border-red-200 dark:border-red-900/40 rounded-2xl">
        <ShieldAlert className="w-10 h-10 text-red-500" />
        <h3 className="text-base font-extrabold text-red-700 dark:text-red-400">Acceso denegado</h3>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Esta consola solo está disponible para administradores y dueños.
        </p>
      </div>
    );
  }

  const handleRetry = async (id?: number) => {
    if (!id) return;
    setLoading(true);
    try {
      await retryError(id);
      addSystemNotification('🔁 Reintento iniciado', `Se reintentó la sincronización del error #${id}.`, 'info');
      await reload();
    } catch (err) {
      addSystemNotification('❌ Reintento fallido', err instanceof Error ? err.message : 'Error desconocido', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryAllNetwork = async () => {
    setLoading(true);
    try {
      await retryAllNetwork();
      addSystemNotification('🔁 Reintentos de red', 'Se programaron retries para todos los errores de red pendientes.', 'info');
      await reload();
    } catch (err) {
      addSystemNotification('❌ Falla en retry masivo', err instanceof Error ? err.message : 'Error desconocido', 'error');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (err: IDBSyncError) => {
    if (!err.id) return;
    let parsed: PayloadShape = {};
    try { parsed = JSON.parse(err.payload) as PayloadShape; } catch { /* keep empty */ }
    setEditingId(err.id);
    setEditForm({
      customer_id: String(parsed.customer_id ?? ''),
      branch_id: String(parsed.branch_id ?? ''),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ customer_id: '', branch_id: '' });
  };

  const saveEdit = async (err: IDBSyncError) => {
    if (!err.id) return;
    let parsed: PayloadShape = {};
    try { parsed = JSON.parse(err.payload) as PayloadShape; } catch {
      addSystemNotification('❌ Payload inválido', 'No se pudo parsear el payload JSON.', 'error');
      return;
    }
    const updated: PayloadShape = {
      ...parsed,
      customer_id: editForm.customer_id.trim() || null,
      branch_id: editForm.branch_id.trim() || parsed.branch_id || null,
    };
    try {
      await syncErrorStore.updatePayload(err.id, JSON.stringify(updated));
      addSystemNotification('✅ Payload actualizado', `Se editó el payload del error #${err.id}.`, 'success');
      cancelEdit();
      await reload();
    } catch (e) {
      addSystemNotification('❌ Error al guardar', e instanceof Error ? e.message : 'Error desconocido', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Consola de errores de sincronización
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Ventas que no pudieron sincronizar con D1. Editá el payload si es validación, o reintentá manualmente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRetryAllNetwork}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-sm cursor-pointer disabled:opacity-50"
            title="Reintenta todos los errores categoría=red pendientes"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Reintentar todos de red
          </button>
        </div>
      </div>

      {errors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-6 text-center bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl">
          <div className="text-3xl mb-2">✅</div>
          <h3 className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">Sin errores pendientes</h3>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">Todas las ventas están sincronizadas con D1.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-900/60">
              <tr className="text-left text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                <th className="px-3 py-2.5">Sale ID</th>
                <th className="px-3 py-2.5">Categoría</th>
                <th className="px-3 py-2.5">Mensaje</th>
                <th className="px-3 py-2.5">Intentos</th>
                <th className="px-3 py-2.5">Próx. reintento</th>
                <th className="px-3 py-2.5">Creado</th>
                <th className="px-3 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {errors.map((err) => {
                const badge = CATEGORY_BADGE[err.category];
                const editing = editingId === err.id;
                return (
                  <React.Fragment key={err.id}>
                    <tr className="hover:bg-gray-50/40 dark:hover:bg-zinc-900/30">
                      <td className="px-3 py-2.5 font-mono text-[10px] text-gray-600 dark:text-zinc-400 max-w-[160px] truncate" title={err.sale_id}>
                        {err.sale_id}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase text-white ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-zinc-300 max-w-[260px] truncate" title={err.message}>
                        {err.message || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold">{err.attempts}</td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-zinc-400">{fmtDate(err.next_retry_at)}</td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-zinc-400">{fmtDate(err.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void handleRetry(err.id)}
                            disabled={loading}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                            title="Reintentar este error"
                          >
                            Reintentar
                          </button>
                          <button
                            onClick={() => editing ? cancelEdit() : startEdit(err)}
                            className="p-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-600 dark:text-zinc-300 cursor-pointer"
                            title={editing ? 'Cancelar edición' : 'Editar customer_id / branch_id'}
                          >
                            {editing ? <X className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editing && (
                      <tr className="bg-amber-50/40 dark:bg-amber-950/10">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="flex flex-col sm:flex-row gap-3 items-end">
                            <label className="flex-1 text-[10px] font-bold uppercase text-gray-600 dark:text-zinc-400 flex flex-col gap-1">
                              Customer ID
                              <input
                                value={editForm.customer_id}
                                onChange={e => setEditForm(f => ({ ...f, customer_id: e.target.value }))}
                                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                                placeholder="(vacío = consumidor final)"
                              />
                            </label>
                            <label className="flex-1 text-[10px] font-bold uppercase text-gray-600 dark:text-zinc-400 flex flex-col gap-1">
                              Branch ID
                              <input
                                value={editForm.branch_id}
                                onChange={e => setEditForm(f => ({ ...f, branch_id: e.target.value }))}
                                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                                placeholder="branch_xxx"
                              />
                            </label>
                            <button
                              onClick={() => void saveEdit(err)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer"
                            >
                              <Save className="h-3.5 w-3.5" /> Guardar
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
