import {
  ClipboardList, Plus, X, Loader2, RefreshCw,
  Clock, Inbox, AlertTriangle, MapPin, ChefHat, Truck, Wrench, Package,
} from 'lucide-react';
import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { useApp } from '../AppContext';
import { useRequests } from '../hooks/useRequests';
import { API_URL, fetchWithAuth } from '../services/api';
import type { ERPRequest, RequestPriority, RequestType } from '../types';

const ROLES = ['cajero', 'cocinero', 'panadero', 'repartidor'] as const;
type AssignableRole = typeof ROLES[number];

const TYPE_OPTIONS: { value: RequestType; label: string; icon: React.ReactNode }[] = [
  { value: 'supply',      label: 'Insumos',     icon: <Package className="h-3 w-3" /> },
  { value: 'production',  label: 'Producción',  icon: <ChefHat className="h-3 w-3" /> },
  { value: 'delivery',    label: 'Entrega',     icon: <Truck className="h-3 w-3" /> },
  { value: 'task',        label: 'Tarea',       icon: <ClipboardList className="h-3 w-3" /> },
  { value: 'maintenance', label: 'Mantenim.',   icon: <Wrench className="h-3 w-3" /> },
  { value: 'custom',      label: 'Otro',        icon: <ClipboardList className="h-3 w-3" /> },
];

const TYPE_COLOR: Record<RequestType, string> = {
  supply:      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  production:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  delivery:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  task:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  maintenance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  custom:      'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300',
};

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

interface Branch { id: string; name?: string; }

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatRoleLabel(role: string): string {
  if (!role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

// ── Create-request modal ─────────────────────────────────────────────────

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

const initialForm: CreateForm = {
  type: 'task',
  title: '',
  description: '',
  assigned_role: 'cajero',
  branch_id: '',
  priority: 'medium',
  is_permanent: false,
  recurrence_days: [1, 2, 3, 4, 5, 6],
  recurrence_time: '08:00',
};

const CreateRequestModal: React.FC<{
  branches: Branch[];
  onClose: () => void;
  onCreated: () => void;
}> = ({ branches, onClose, onCreated }) => {
  const [form, setForm] = useState<CreateForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleDay = (d: number) => {
    setForm(f => ({
      ...f,
      recurrence_days: f.recurrence_days.includes(d)
        ? f.recurrence_days.filter(x => x !== d)
        : [...f.recurrence_days, d].sort(),
    }));
  };

  const submit = async () => {
    if (!form.title.trim()) {
      setErr('Título obligatorio');
      return;
    }
    setSubmitting(true);
    setErr(null);
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

        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded p-1.5">
          Como admin, las solicitudes creadas se auto-aprueban.
        </p>

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
        </div>

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
            Crear solicitud
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Admin card ───────────────────────────────────────────────────────────

const AdminCard: React.FC<{ request: ERPRequest; onAction?: (action: string, id: string) => Promise<void>; busy: boolean }> = ({ request, onAction, busy }) => {
  const typeColor = TYPE_COLOR[request.type] ?? TYPE_COLOR.custom;
  const meta = TYPE_OPTIONS.find(t => t.value === request.type);
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-orange-100/40 dark:border-zinc-800 p-3 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${typeColor}`}>
            {meta?.icon}{meta?.label ?? request.type}
          </span>
          <span className="text-[10px] font-bold text-gray-500 dark:text-zinc-400 uppercase">
            → {formatRoleLabel(request.assigned_role)}
          </span>
          <PriorityDot p={request.priority} />
        </div>
        <span className="text-[10px] text-gray-400 dark:text-zinc-500 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatTime(request.created_at)}
        </span>
      </div>

      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">{request.title}</h4>
        {request.description && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400 line-clamp-2">{request.description}</p>
        )}
      </div>

      {request.branch_name && (
        <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400">
          <MapPin className="h-3 w-3" />
          {request.branch_name}
        </div>
      )}

      {request.status === 'pending_approval' && onAction && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => void onAction('approve', request.id)}
            disabled={busy}
            className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50"
          >
            Aprobar
          </button>
          <button
            onClick={() => void onAction('reject', request.id)}
            disabled={busy}
            className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50"
          >
            Rechazar
          </button>
        </div>
      )}

      {request.status === 'reassignment_requested' && onAction && (
        <button
          onClick={() => void onAction('reassign-approve', request.id)}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-50"
        >
          Liberar
        </button>
      )}

      {request.status === 'completed' && (
        <div className="text-[11px] text-gray-500 dark:text-zinc-400 grid grid-cols-2 gap-1 mt-1 border-t border-gray-100 dark:border-zinc-800 pt-2">
          {typeof request.duration_minutes === 'number' && (
            <div><span className="text-gray-400">Duración:</span> {request.duration_minutes} min</div>
          )}
          {typeof request.cost_spent === 'number' && (
            <div><span className="text-gray-400">Costo:</span> ${request.cost_spent.toFixed(2)}</div>
          )}
          {request.accepted_by_role && (
            <div className="col-span-2"><span className="text-gray-400">Cerrada por:</span> {request.accepted_by_role}</div>
          )}
          {request.incidents && (
            <div className="col-span-2 mt-1 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded p-1.5 text-amber-800 dark:text-amber-300 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="italic">{request.incidents}</span>
            </div>
          )}
        </div>
      )}

      {request.rejection_reason && (
        <div className="text-[11px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded p-1.5">
          <strong>Rechazada:</strong> {request.rejection_reason}
        </div>
      )}
      {request.reassignment_note && request.status === 'reassignment_requested' && (
        <div className="text-[11px] text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/40 rounded p-1.5">
          <strong>Arrepentido:</strong> {request.reassignment_note}
        </div>
      )}
    </div>
  );
};

const PriorityDot: React.FC<{ p: RequestPriority }> = ({ p }) => {
  const cls = p === 'high' ? 'bg-red-500' : p === 'medium' ? 'bg-amber-500' : 'bg-gray-400';
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 dark:text-zinc-400">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} />
      {p}
    </span>
  );
};

// ── Section accordion ────────────────────────────────────────────────────

const Section: React.FC<{
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between mb-2 px-1 text-sm font-bold text-gray-700 dark:text-zinc-200 hover:text-amber-500 transition-colors"
      >
        <span>{title} <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500">({count})</span></span>
        <span className="text-xs">{open ? '−' : '+'}</span>
      </button>
      {open && children}
    </div>
  );
};

// ── main view ────────────────────────────────────────────────────────────

export const AdminRequestsView: React.FC = () => {
  const { addSystemNotification } = useApp();
  const { requests, loading, error, invalidate, refetch } = useRequests();
  const [filter, setFilter] = useState<'all' | AssignableRole>('all');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ERPRequest | null>(null);

  // Cargar branches al montar (admin tiene acceso a todas)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/v1/branches?limit=100`);
        if (!res.ok) return;
        const data = (await res.json()) as { success?: boolean; data?: Branch[] };
        if (!cancelled && Array.isArray(data?.data)) setBranches(data.data);
      } catch {
        // ignoramos: el form puede quedar sin branches preseleccionadas
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter(r => r.assigned_role === filter);
  }, [requests, filter]);

  const pending = useMemo(() => filtered.filter(r => r.status === 'pending_approval' || r.status === 'reassignment_requested'), [filtered]);
  const inProgress = useMemo(() => filtered.filter(r =>
    r.status === 'approved' || r.status === 'accepted' || r.status === 'in_progress'
  ), [filtered]);
  const completedToday = useMemo(() => filtered.filter(r =>
    r.status === 'completed' && isToday(r.time_completed ?? r.updated_at)
  ), [filtered]);

  const handleAdminAction = useCallback(async (action: string, id: string) => {
    // Reject abre un modal en lugar de window.prompt — mejor UX y evita el warn de eslint
    if (action === 'reject') {
      const target = requests.find(r => r.id === id) ?? null;
      setRejectTarget(target);
      return;
    }
    setBusyId(id);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests/${id}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data?.error?.message) msg = data.error.message;
        } catch { /* noop */ }
        addSystemNotification('Error', msg, 'error');
        return;
      }
      await invalidate();
    } catch (e) {
      addSystemNotification('Error', e instanceof Error ? e.message : 'Acción fallida', 'error');
    } finally {
      setBusyId(null);
    }
  }, [addSystemNotification, invalidate, requests]);

  const submitReject = useCallback(async (reason: string) => {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests/${rejectTarget.id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: reason }),
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data?.error?.message) msg = data.error.message;
        } catch { /* noop */ }
        addSystemNotification('Error', msg, 'error');
        return;
      }
      setRejectTarget(null);
      await invalidate();
    } catch (e) {
      addSystemNotification('Error', e instanceof Error ? e.message : 'Acción fallida', 'error');
    } finally {
      setBusyId(null);
    }
  }, [addSystemNotification, invalidate, rejectTarget]);

  if (loading && !requests.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-xs mt-2">Cargando solicitudes…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-amber-500" />
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Panel de Solicitudes</h1>
          {pending.length > 0 && (
            <span className="bg-yellow-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{pending.length} pend.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as 'all' | AssignableRole)}
            className="text-xs font-bold px-2 py-1.5 border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300"
          >
            <option value="all">Todos los roles</option>
            {ROLES.map(r => <option key={r} value={r}>{formatRoleLabel(r)}</option>)}
          </select>
          <button
            onClick={() => void refetch()}
            className="text-gray-400 hover:text-amber-500 transition-colors p-1"
            aria-label="Refrescar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-xs px-4 py-1.5 border-b border-amber-200 dark:border-amber-900/40">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-zinc-600 gap-3">
            <Inbox className="h-12 w-12" />
            <p className="text-sm font-medium">No hay solicitudes para mostrar</p>
          </div>
        )}

        {pending.length > 0 && (
          <Section title="Pendientes de aprobación" count={pending.length}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map(r => (
                <AdminCard key={r.id} request={r} onAction={handleAdminAction} busy={busyId === r.id} />
              ))}
            </div>
          </Section>
        )}

        {inProgress.length > 0 && (
          <Section title="En progreso" count={inProgress.length}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inProgress.map(r => (
                <AdminCard key={r.id} request={r} busy={busyId === r.id} />
              ))}
            </div>
          </Section>
        )}

        {completedToday.length > 0 && (
          <Section title="Completadas hoy" count={completedToday.length}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {completedToday.map(r => (
                <AdminCard key={r.id} request={r} busy={busyId === r.id} />
              ))}
            </div>
          </Section>
        )}
      </div>

      {showCreate && (
        <CreateRequestModal
          branches={branches}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            addSystemNotification('Solicitud creada', 'La solicitud se creó y aprobó automáticamente.', 'success');
            await invalidate();
          }}
        />
      )}

      {rejectTarget && (
        <RejectModal
          request={rejectTarget}
          busy={busyId === rejectTarget.id}
          onClose={() => setRejectTarget(null)}
          onSubmit={submitReject}
        />
      )}
    </div>
  );
};

const RejectModal: React.FC<{
  request: ERPRequest;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}> = ({ request, busy, onClose, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Rechazar solicitud</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-zinc-400">{request.title}</p>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Motivo</span>
          <textarea
            rows={4}
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            placeholder="Explicá brevemente..."
          />
        </label>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={busy}
            className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={async () => {
              if (!reason.trim()) { setErr('El motivo es obligatorio'); return; }
              setErr(null);
              await onSubmit(reason.trim());
            }}
            disabled={busy}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminRequestsView;
