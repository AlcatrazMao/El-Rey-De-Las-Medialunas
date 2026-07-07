import {
  Plus, X, Loader2,
} from 'lucide-react';
import React, { useState, useMemo } from 'react';

import { useApp } from '../../AppContext';
import { API_URL, fetchWithAuth } from '../../services/api';
import type { RequestPriority, RequestType } from '../../types';

import { TYPE_OPTIONS, formatRoleLabel } from './shared';

// Modal de creación de solicitudes reutilizado por el panel de admin
// (AdminRequestsView) y por la vista de operador (RequestsView / Mermas /
// Producción). El backend decide el status según el rol del creador:
// admin/owner → auto-aprobada (o completed en waste); resto → pending_approval.

export interface Branch { id: string; name?: string; }

const ROLES = ['cajero', 'cocinero', 'panadero', 'repartidor'] as const;
type AssignableRole = typeof ROLES[number];

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

interface CreateForm {
  type: RequestType;
  title: string;
  description: string;
  assigned_role: AssignableRole;
  branch_id: string;
  priority: RequestPriority;
  is_permanent: boolean;
  recurrence_days: number[];
  recurrence_time: string;
}

export const CreateRequestModal: React.FC<{
  /** Sucursales seleccionables (admin). Opcional: el operador puede crear sin sucursal. */
  branches?: Branch[];
  /** Si se fija, el tipo queda preseleccionado y bloqueado (Mermas/Producción). */
  lockedType?: RequestType;
  /** Muestra el aviso de auto-aprobación cuando el creador es admin/owner. */
  isAdmin?: boolean;
  onClose: () => void;
  onCreated: () => void;
}> = ({ branches = [], lockedType, isAdmin = false, onClose, onCreated }) => {
  const { products = [], batches = [], requestBatchWithdrawal, addSystemNotification } = useApp();

  const [form, setForm] = useState<CreateForm>({
    type: lockedType ?? 'task',
    title: '',
    description: '',
    assigned_role: 'cajero',
    branch_id: '',
    priority: 'medium',
    is_permanent: false,
    recurrence_days: [1, 2, 3, 4, 5, 6],
    recurrence_time: '08:00',
  });

  // Sub-formulario específico de mermas (type === 'waste').
  const [wasteProductId, setWasteProductId] = useState<string>(products[0]?.id ?? '');
  const [wasteBatchId, setWasteBatchId] = useState<string>('');
  const [wasteQty, setWasteQty] = useState<number>(1);
  const [wasteReason, setWasteReason] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isWaste = form.type === 'waste';

  const productBatches = useMemo(
    () => batches.filter(b => b.productId === wasteProductId && b.status === 'active' && b.stock > 0),
    [batches, wasteProductId],
  );
  const activeWasteBatch = useMemo(
    () => batches.find(b => b.id === wasteBatchId) ?? null,
    [batches, wasteBatchId],
  );

  const handleWasteProductChange = (prodId: string) => {
    setWasteProductId(prodId);
    const first = batches.find(b => b.productId === prodId && b.status === 'active' && b.stock > 0);
    setWasteBatchId(first ? first.id : '');
    setWasteQty(1);
  };

  const toggleDay = (d: number) => {
    setForm(f => ({
      ...f,
      recurrence_days: f.recurrence_days.includes(d)
        ? f.recurrence_days.filter(x => x !== d)
        : [...f.recurrence_days, d].sort(),
    }));
  };

  const submit = async () => {
    setErr(null);

    // Camino especial: mermas → reutilizamos requestBatchWithdrawal (useBatches),
    // que ya arma el POST con metadata {batch_id, product_id, quantity, reason}.
    if (isWaste) {
      if (!wasteBatchId) { setErr('Seleccioná un lote activo'); return; }
      if (wasteQty <= 0) { setErr('La cantidad debe ser mayor a 0'); return; }
      if (activeWasteBatch && wasteQty > activeWasteBatch.stock) {
        setErr(`La cantidad supera el stock del lote (${activeWasteBatch.stock} u.)`);
        return;
      }
      if (!wasteReason.trim()) { setErr('El motivo es obligatorio'); return; }
      setSubmitting(true);
      try {
        const result = await requestBatchWithdrawal(wasteBatchId, wasteQty, wasteReason.trim());
        setSubmitting(false);
        // Estado intermedio: sin red, la merma quedó encolada y se sincroniza
        // sola al volver la conexión. No es un error, pero tampoco un OK total.
        if (result?.queued) {
          addSystemNotification(
            'Merma en cola',
            'Merma registrada, se sincronizará cuando vuelva la conexión.',
            'warning',
          );
        }
        onCreated();
      } catch (e) {
        // Falló el POST por un error REAL (validación/servidor): mantenemos el
        // modal abierto con el error inline, sin encolar ni mentir un "éxito".
        setSubmitting(false);
        setErr(e instanceof Error ? e.message : 'No se pudo registrar la merma');
      }
      return;
    }

    // Camino genérico: POST directo a /api/v2/requests.
    if (!form.title.trim()) { setErr('Título obligatorio'); return; }
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      assigned_role: form.assigned_role,
      branch_id: form.branch_id || undefined,
      priority: form.priority,
      is_permanent: form.is_permanent ? 1 : 0,
    };
    if (form.is_permanent) {
      payload.recurrence_days = form.recurrence_days;
      payload.recurrence_time = form.recurrence_time;
    }
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data?.error?.message) msg = data.error.message;
        } catch { /* noop */ }
        setErr(msg);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      onCreated();
    } catch (e) {
      setSubmitting(false);
      setErr(e instanceof Error ? e.message : 'Error de red');
    }
  };

  const lockedTypeMeta = lockedType ? TYPE_OPTIONS.find(t => t.value === lockedType) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Plus className="h-4 w-4 text-amber-500" /> Nueva solicitud
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isAdmin ? (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded p-1.5">
            Como admin, las solicitudes creadas se auto-aprueban.
          </p>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
            La solicitud quedará pendiente de aprobación por administración.
          </p>
        )}

        {/* Tipo: si viene bloqueado (Mermas/Producción) se muestra fijo. */}
        {lockedType ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-zinc-300">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {lockedTypeMeta?.icon}{lockedTypeMeta?.label ?? lockedType}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Tipo</span>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as RequestType }))}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              >
                {TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

            {!isWaste && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Prioridad</span>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as RequestPriority }))}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </label>
            )}
          </div>
        )}

        {isWaste ? (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Producto</span>
              <select
                value={wasteProductId}
                onChange={e => handleWasteProductChange(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              >
                <option value="" disabled>Seleccionar artículo…</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.image} {p.name} (Stock: {p.stock} u.)</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Lote activo</span>
              <select
                value={wasteBatchId}
                onChange={e => { setWasteBatchId(e.target.value); setWasteQty(1); }}
                disabled={productBatches.length === 0}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 disabled:opacity-50"
              >
                <option value="">
                  {productBatches.length === 0 ? 'No hay lotes activos para este producto' : '— Elegí un lote —'}
                </option>
                {productBatches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber} · Disp: {b.stock} u. (Vence: {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('es-AR') : '—'})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300 flex items-center justify-between">
                Cantidad a dar de baja
                {activeWasteBatch && <span className="text-[10px] text-amber-600 font-bold">Máx: {activeWasteBatch.stock} u.</span>}
              </span>
              <input
                type="number"
                min="1"
                max={activeWasteBatch ? activeWasteBatch.stock : 9999}
                value={wasteQty}
                onChange={e => setWasteQty(Number(e.target.value))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Motivo</span>
              <textarea
                rows={3}
                value={wasteReason}
                onChange={e => setWasteReason(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                placeholder="Ej: Lote caducó en góndola, retirar de la venta."
              />
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Título</span>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="Comprar harina 0000"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Descripción</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                placeholder="Detalle opcional..."
              />
            </label>

            {lockedType && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Prioridad</span>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as RequestPriority }))}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Asignar a</span>
                <select
                  value={form.assigned_role}
                  onChange={e => setForm(f => ({ ...f, assigned_role: e.target.value as AssignableRole }))}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                >
                  {ROLES.map(r => <option key={r} value={r}>{formatRoleLabel(r)}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Sucursal</span>
                <select
                  value={form.branch_id}
                  onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                >
                  <option value="">— Sin sucursal —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name ?? b.id}</option>)}
                </select>
              </label>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_permanent}
                onChange={e => setForm(f => ({ ...f, is_permanent: e.target.checked }))}
                className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
              />
              Solicitud permanente (recurrente)
            </label>

            {form.is_permanent && (
              <div className="space-y-2 border-l-2 border-amber-200 dark:border-amber-900/40 pl-3">
                <div>
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Días</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {DAY_LABELS.map((label, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleDay(idx)}
                        className={`px-2 py-1 text-[11px] font-bold rounded-md border ${
                          form.recurrence_days.includes(idx)
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Hora</span>
                  <input
                    type="time"
                    value={form.recurrence_time}
                    onChange={e => setForm(f => ({ ...f, recurrence_time: e.target.value }))}
                    className="mt-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                  />
                </label>
              </div>
            )}
          </>
        )}

        {err && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded px-2 py-1">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={submitting}
            className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            {isWaste ? 'Solicitar merma' : 'Crear solicitud'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateRequestModal;
