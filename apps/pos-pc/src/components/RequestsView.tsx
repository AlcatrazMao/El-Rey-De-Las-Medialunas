import {
  ClipboardList, Clock, CheckCircle2, X, Play, Undo2,
  AlertTriangle, MapPin, Truck, ChefHat, Wrench, Package,
  Loader2, RefreshCw, Inbox,
} from 'lucide-react';
import React, { useState, useMemo, useCallback } from 'react';

import { useApp } from '../AppContext';
import { useRequests } from '../hooks/useRequests';
import { API_URL, fetchWithAuth } from '../services/api';
import type { ERPRequest, RequestPriority, RequestStatus, RequestType } from '../types';

// ── helpers ──────────────────────────────────────────────────────────────

const TYPE_META: Record<RequestType, { label: string; icon: React.ReactNode; color: string }> = {
  supply:      { label: 'Insumos',      icon: <Package className="h-3 w-3" />,    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  production:  { label: 'Producción',   icon: <ChefHat className="h-3 w-3" />,    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  delivery:    { label: 'Entrega',      icon: <Truck className="h-3 w-3" />,      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  task:        { label: 'Tarea',        icon: <ClipboardList className="h-3 w-3" />, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  maintenance: { label: 'Mantenim.',    icon: <Wrench className="h-3 w-3" />,     color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  custom:      { label: 'Otro',         icon: <ClipboardList className="h-3 w-3" />, color: 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

const PRIORITY_META: Record<RequestPriority, { label: string; dot: string }> = {
  low:    { label: 'Baja',  dot: 'bg-gray-400' },
  medium: { label: 'Media', dot: 'bg-amber-500' },
  high:   { label: 'Alta',  dot: 'bg-red-500' },
};

const STATUS_META: Record<RequestStatus, { label: string; cls: string }> = {
  pending_approval:        { label: 'Pendiente aprobación', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved:                { label: 'Aprobada',             cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  rejected:                { label: 'Rechazada',            cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  accepted:                { label: 'Aceptada',             cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  in_progress:             { label: 'En progreso',          cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  completed:               { label: 'Completada',           cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  reassignment_requested:  { label: 'Pide reasignar',       cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  cancelled:               { label: 'Cancelada',            cls: 'bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400' },
};

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

// ── API helpers ──────────────────────────────────────────────────────────

type ApiBody = Record<string, unknown>;

async function postRequestAction(id: string, action: string, body?: ApiBody): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/v2/requests/${id}/${action}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try {
        const data = (await res.json()) as { error?: { message?: string } };
        if (data?.error?.message) msg = data.error.message;
      } catch { /* noop */ }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red' };
  }
}

// ── modals ───────────────────────────────────────────────────────────────

interface CompleteFormState {
  cost_spent?: string;
  incidents?: string;
}

const CompleteModal: React.FC<{
  request: ERPRequest;
  onClose: () => void;
  onDone: () => void;
}> = ({ request, onClose, onDone }) => {
  const [form, setForm] = useState<CompleteFormState>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    const cost = form.cost_spent ? Number(form.cost_spent) : undefined;
    const body: ApiBody = {};
    if (cost !== undefined && !Number.isNaN(cost)) body.cost_spent = cost;
    if (form.incidents?.trim()) body.incidents = form.incidents.trim();
    const result = await postRequestAction(request.id, 'complete', body);
    setSubmitting(false);
    if (!result.ok) {
      setErr(result.error ?? 'No se pudo completar');
      return;
    }
    onDone();
  };

  return (
    <ModalShell title="Completar solicitud" onClose={onClose}>
      <p className="text-xs text-gray-500 dark:text-zinc-400">{request.title}</p>

      <label className="block">
        <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Costo gastado (opcional)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={form.cost_spent ?? ''}
          onChange={e => setForm(f => ({ ...f, cost_spent: e.target.value }))}
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          placeholder="0.00"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Incidentes (opcional)</span>
        <textarea
          rows={3}
          value={form.incidents ?? ''}
          onChange={e => setForm(f => ({ ...f, incidents: e.target.value }))}
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          placeholder="Algo a destacar..."
        />
      </label>

      {err && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded px-2 py-1">
          {err}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={onClose}
          disabled={submitting}
          className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          Completar solicitud
        </button>
      </div>
    </ModalShell>
  );
};

const ReasonModal: React.FC<{
  title: string;
  ctaLabel: string;
  action: 'reject' | 'reassign-request';
  request: ERPRequest;
  onClose: () => void;
  onDone: () => void;
}> = ({ title, ctaLabel, action, request, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setErr('El motivo es obligatorio');
      return;
    }
    setSubmitting(true);
    setErr(null);
    const body: ApiBody = action === 'reject'
      ? { rejection_reason: reason.trim() }
      : { reassignment_note: reason.trim() };
    const result = await postRequestAction(request.id, action, body);
    setSubmitting(false);
    if (!result.ok) {
      setErr(result.error ?? 'No se pudo enviar');
      return;
    }
    onDone();
  };

  return (
    <ModalShell title={title} onClose={onClose}>
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
      {err && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded px-2 py-1">
          {err}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={onClose} disabled={submitting}
          className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={submit} disabled={submitting}
          className="flex-1 px-3 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          {ctaLabel}
        </button>
      </div>
    </ModalShell>
  );
};

const ConfirmTakeOptionalModal: React.FC<{
  request: ERPRequest;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}> = ({ request, onClose, onConfirm }) => {
  const [submitting, setSubmitting] = useState(false);
  return (
    <ModalShell title="Tomar solicitud opcional" onClose={onClose}>
      <p className="text-sm text-gray-700 dark:text-zinc-200">
        Esta solicitud corresponde al rol <strong className="text-amber-600 dark:text-amber-400">{formatRoleLabel(request.assigned_role)}</strong>.
        Al aceptarla, te comprometés a completarla.
      </p>
      <p className="text-xs text-gray-500 dark:text-zinc-400">¿Querés tomarla?</p>
      <div className="flex gap-2 pt-2">
        <button onClick={onClose} disabled={submitting}
          className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50">
          Cancelar
        </button>
        <button
          onClick={async () => { setSubmitting(true); await onConfirm(); setSubmitting(false); }}
          disabled={submitting}
          className="flex-1 px-3 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          Sí, la tomo
        </button>
      </div>
    </ModalShell>
  );
};

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <div
      className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

// ── card ────────────────────────────────────────────────────────────────

interface ActionState {
  type: 'complete' | 'reject' | 'reassign' | 'take_optional' | null;
  request: ERPRequest | null;
}

const RequestCard: React.FC<{
  request: ERPRequest;
  isAdmin: boolean;
  isOptional?: boolean;
  showCompletionMeta?: boolean;
  onAction: (type: ActionState['type'], r: ERPRequest) => void;
  onSimpleAction: (action: string, r: ERPRequest) => Promise<void>;
  busyId: string | null;
}> = ({ request, isAdmin, isOptional, showCompletionMeta, onAction, onSimpleAction, busyId }) => {
  const typeMeta = TYPE_META[request.type] ?? TYPE_META.custom;
  const priorityMeta = PRIORITY_META[request.priority];
  const statusMeta = STATUS_META[request.status];
  const busy = busyId === request.id;

  const renderActions = () => {
    if (request.status === 'pending_approval' && isAdmin) {
      return (
        <div className="flex gap-2">
          <button
            onClick={() => onSimpleAction('approve', request)}
            disabled={busy}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
          </button>
          <button
            onClick={() => onAction('reject', request)}
            disabled={busy}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Rechazar
          </button>
        </div>
      );
    }

    if (request.status === 'approved') {
      return (
        <button
          onClick={() => isOptional ? onAction('take_optional', request) : void onSimpleAction('accept', request)}
          disabled={busy}
          className="w-full px-3 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {isOptional ? 'Tomar esta solicitud' : 'Aceptar'}
        </button>
      );
    }

    if (request.status === 'accepted' || request.status === 'in_progress') {
      return (
        <div className="flex gap-2">
          <button
            onClick={() => onAction('complete', request)}
            disabled={busy}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Completar
          </button>
          <button
            onClick={() => onAction('reassign', request)}
            disabled={busy}
            className="px-3 py-2 text-xs font-bold text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-950/30 hover:bg-orange-200 dark:hover:bg-orange-900/40 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
            title="Solicitar arrepentido"
          >
            <Undo2 className="h-3.5 w-3.5" /> Arrepentido
          </button>
        </div>
      );
    }

    if (request.status === 'reassignment_requested' && isAdmin) {
      return (
        <button
          onClick={() => onSimpleAction('reassign-approve', request)}
          disabled={busy}
          className="w-full px-3 py-2 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Undo2 className="h-3.5 w-3.5" /> Liberar solicitud
        </button>
      );
    }

    return null;
  };

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-2xl border p-3 md:p-4 flex flex-col gap-2 shadow-sm transition-all ${
      request.status === 'completed' ? 'border-emerald-200 dark:border-emerald-900/40 opacity-90' :
      request.status === 'rejected' || request.status === 'cancelled' ? 'border-gray-200 dark:border-zinc-800 opacity-60' :
      'border-orange-100/40 dark:border-zinc-800'
    }`}>
      {/* Top row: tipo + prioridad + hora */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${typeMeta.color}`}>
            {typeMeta.icon}{typeMeta.label}
          </span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${priorityMeta && 'text-gray-600 dark:text-zinc-400'}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityMeta?.dot ?? 'bg-gray-300'}`} />
            {priorityMeta?.label}
          </span>
          {isOptional && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              Opcional · {formatRoleLabel(request.assigned_role)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400 dark:text-zinc-500 flex items-center gap-1 shrink-0">
          <Clock className="h-3 w-3" />
          {formatTime(request.created_at)}
        </span>
      </div>

      {/* Título + descripción */}
      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">{request.title}</h4>
        {request.description && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400 line-clamp-2">{request.description}</p>
        )}
      </div>

      {/* Branch */}
      {request.branch_name && (
        <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400">
          <MapPin className="h-3 w-3" />
          {request.branch_name}
        </div>
      )}

      {/* Status badge (cuando es informativo, no actionable) */}
      {(request.status === 'completed' || request.status === 'rejected' || request.status === 'cancelled') && (
        <div className={`inline-flex items-center self-start gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${statusMeta.cls}`}>
          {statusMeta.label}
        </div>
      )}

      {/* Métricas de cierre (admin completed) */}
      {showCompletionMeta && request.status === 'completed' && (
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

      {/* Rejection reason / reassignment note visible */}
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

      {/* Actions */}
      <div className="pt-1">{renderActions()}</div>
    </div>
  );
};

// ── main view ────────────────────────────────────────────────────────────

interface RequestsViewProps {
  /** Si se setea, filtra solo este tipo (usado por DeliveryView). */
  typeFilter?: RequestType;
}

export const RequestsView: React.FC<RequestsViewProps> = ({ typeFilter }) => {
  const { activeUser, addSystemNotification } = useApp();
  const { requests, loading, error, invalidate, refetch } = useRequests();
  const [tab, setTab] = useState<'mine' | 'optional'>('mine');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<ActionState>({ type: null, request: null });

  const role = (activeUser?.role ?? 'panadero') as string;
  const isAdmin = role === 'admin' || role === 'owner' || role === 'supervisor';

  // Aplicamos primero typeFilter si vino
  const baseRequests = useMemo(() => {
    return typeFilter ? requests.filter(r => r.type === typeFilter) : requests;
  }, [requests, typeFilter]);

  const mine = useMemo(() => {
    return baseRequests.filter(r => {
      // "Mías" = asignadas a mi rol Y en un estado activo (no terminadas)
      if (r.assigned_role !== role) return false;
      return r.status !== 'rejected' && r.status !== 'cancelled';
    });
  }, [baseRequests, role]);

  const optional = useMemo(() => {
    // Solicitudes APROBADAS de OTROS roles que aún no fueron tomadas definitivamente.
    // is_optional_acceptance === 1 marca post-aceptación, NO indica disponibilidad.
    return baseRequests.filter(r =>
      r.status === 'approved'
      && r.assigned_role !== role
      && r.assigned_role !== 'all'
    );
  }, [baseRequests, role]);

  // Agrupar opcionales por rol original
  const optionalGrouped = useMemo(() => {
    const groups: Record<string, ERPRequest[]> = {};
    for (const r of optional) {
      const k = r.assigned_role || 'otros';
      if (!groups[k]) groups[k] = [];
      groups[k].push(r);
    }
    return groups;
  }, [optional]);

  const handleSimpleAction = useCallback(async (action: string, r: ERPRequest) => {
    setBusyId(r.id);
    try {
      const result = await postRequestAction(r.id, action);
      if (!result.ok) {
        addSystemNotification('Error', result.error ?? 'Acción fallida', 'error');
        return;
      }
      await invalidate();
    } finally {
      setBusyId(null);
    }
  }, [addSystemNotification, invalidate]);

  const handleOpenModal = useCallback((type: ActionState['type'], r: ERPRequest) => {
    setModal({ type, request: r });
  }, []);

  const handleCloseModal = useCallback(() => setModal({ type: null, request: null }), []);

  const handleModalDone = useCallback(async () => {
    handleCloseModal();
    await invalidate();
  }, [handleCloseModal, invalidate]);

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
          <h1 className="text-base font-bold text-gray-900 dark:text-white">
            {typeFilter ? `Solicitudes · ${TYPE_META[typeFilter].label}` : 'Solicitudes'}
          </h1>
          {mine.length > 0 && (
            <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{mine.length}</span>
          )}
        </div>
        <button
          onClick={() => void refetch()}
          className="text-gray-400 hover:text-amber-500 transition-colors"
          aria-label="Refrescar"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-xs px-4 py-1.5 border-b border-amber-200 dark:border-amber-900/40">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="px-4 py-2 flex gap-2 shrink-0 bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800">
        <button
          onClick={() => setTab('mine')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
            tab === 'mine'
              ? 'bg-amber-500 text-white border-amber-600'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:border-amber-400'
          }`}
        >
          Mis solicitudes {mine.length > 0 && `(${mine.length})`}
        </button>
        <button
          onClick={() => setTab('optional')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
            tab === 'optional'
              ? 'bg-amber-500 text-white border-amber-600'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:border-amber-400'
          }`}
        >
          Opcionales {optional.length > 0 && `(${optional.length})`}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'mine' && (
          <>
            {!mine.length && (
              <EmptyState label="No tenés solicitudes asignadas" />
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map(r => (
                <RequestCard
                  key={r.id}
                  request={r}
                  isAdmin={isAdmin}
                  onAction={handleOpenModal}
                  onSimpleAction={handleSimpleAction}
                  busyId={busyId}
                />
              ))}
            </div>
          </>
        )}

        {tab === 'optional' && (
          <>
            {!optional.length && (
              <EmptyState label="No hay solicitudes opcionales" />
            )}
            <div className="space-y-4">
              {Object.entries(optionalGrouped).map(([roleKey, list]) => (
                <div key={roleKey}>
                  <h3 className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2 px-1">
                    Para {formatRoleLabel(roleKey)} ({list.length})
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map(r => (
                      <RequestCard
                        key={r.id}
                        request={r}
                        isAdmin={isAdmin}
                        isOptional
                        onAction={handleOpenModal}
                        onSimpleAction={handleSimpleAction}
                        busyId={busyId}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {modal.type === 'complete' && modal.request && (
        <CompleteModal request={modal.request} onClose={handleCloseModal} onDone={handleModalDone} />
      )}
      {modal.type === 'reject' && modal.request && (
        <ReasonModal
          title="Rechazar solicitud"
          ctaLabel="Rechazar"
          action="reject"
          request={modal.request}
          onClose={handleCloseModal}
          onDone={handleModalDone}
        />
      )}
      {modal.type === 'reassign' && modal.request && (
        <ReasonModal
          title="Solicitar arrepentido"
          ctaLabel="Enviar"
          action="reassign-request"
          request={modal.request}
          onClose={handleCloseModal}
          onDone={handleModalDone}
        />
      )}
      {modal.type === 'take_optional' && modal.request && (
        <ConfirmTakeOptionalModal
          request={modal.request}
          onClose={handleCloseModal}
          onConfirm={async () => {
            const r = modal.request!;
            const result = await postRequestAction(r.id, 'accept');
            if (!result.ok) {
              addSystemNotification('Error', result.error ?? 'No se pudo tomar', 'error');
              await invalidate(); // sincronizar para quitar el ítem que ya fue tomado
              handleCloseModal();
              return;
            }
            await handleModalDone();
          }}
        />
      )}
    </div>
  );
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-zinc-600 gap-3">
    <Inbox className="h-12 w-12" />
    <p className="text-sm font-medium">{label}</p>
  </div>
);

export default RequestsView;
