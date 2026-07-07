import {
  ClipboardList, Plus, X, Loader2, RefreshCw,
  Clock, Inbox, AlertTriangle, MapPin,
} from 'lucide-react';
import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { useApp } from '../AppContext';
import { useRequests } from '../hooks/useRequests';
import { API_URL, fetchWithAuth } from '../services/api';
import type { ERPRequest, RequestPriority, RequestType } from '../types';

import { CreateRequestModal, type Branch } from './requests/CreateRequestModal';
import {
  TYPE_OPTIONS, getTypeMeta, WASTE_APPROVER_ROLES,
  formatTime, formatRoleLabel, isToday, TypeFilterTab,
} from './requests/shared';

const ROLES = ['cajero', 'cocinero', 'panadero', 'repartidor'] as const;
type AssignableRole = typeof ROLES[number];

// ── Admin card ───────────────────────────────────────────────────────────

const AdminCard: React.FC<{ request: ERPRequest; onAction?: (action: string, id: string) => Promise<void>; busy: boolean; activeRole: string }> = ({ request, onAction, busy, activeRole }) => {
  const meta = getTypeMeta(request.type);
  const typeColor = meta.color;
  // Mermas: solo admin/owner pueden aprobar o rechazar. Un supervisor no puede resolverlas.
  const wasteBlocked = request.type === 'waste' && !WASTE_APPROVER_ROLES.includes(activeRole);
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-orange-100/40 dark:border-zinc-800 p-3 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${typeColor}`}>
            {meta.icon}{meta.label}
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
        wasteBlocked ? (
          <div className="pt-1 text-[11px] font-semibold text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Solo admin/dueño puede resolver mermas
          </div>
        ) : (
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
        )
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
      {request.admin_note && request.status !== 'pending_approval' && (
        <div className="text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded p-1.5">
          <strong>Aprobada:</strong> {request.admin_note}
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
  const { addSystemNotification, activeUser } = useApp();
  const { requests, loading, error, invalidate, refetch } = useRequests();
  const [filter, setFilter] = useState<'all' | AssignableRole>('all');
  const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ERPRequest | null>(null);
  const [approveTarget, setApproveTarget] = useState<ERPRequest | null>(null);

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

  const activeRole = (activeUser?.role ?? '') as string;

  const filtered = useMemo(() => {
    return requests.filter(r =>
      (filter === 'all' || r.assigned_role === filter) &&
      (typeFilter === 'all' || r.type === typeFilter)
    );
  }, [requests, filter, typeFilter]);

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
    // Aprobar exige una justificación no vacía (auditoría): abre modal igual que reject.
    if (action === 'approve') {
      const target = requests.find(r => r.id === id) ?? null;
      setApproveTarget(target);
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

  const submitApprove = useCallback(async (note: string) => {
    if (!approveTarget) return;
    setBusyId(approveTarget.id);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests/${approveTarget.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_note: note }),
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
      setApproveTarget(null);
      await invalidate();
    } catch (e) {
      addSystemNotification('Error', e instanceof Error ? e.message : 'Acción fallida', 'error');
    } finally {
      setBusyId(null);
    }
  }, [addSystemNotification, invalidate, approveTarget]);

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

      {/* Sub-nav por tipo. Se combina con el filtro por rol del header. */}
      <div className="px-4 py-2 flex gap-1.5 flex-wrap shrink-0 bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800">
        <TypeFilterTab
          label="Todas"
          active={typeFilter === 'all'}
          onClick={() => setTypeFilter('all')}
        />
        {TYPE_OPTIONS.map(opt => (
          <TypeFilterTab
            key={opt.value}
            label={opt.label}
            icon={opt.icon}
            active={typeFilter === opt.value}
            onClick={() => setTypeFilter(opt.value)}
          />
        ))}
      </div>

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
                <AdminCard key={r.id} request={r} onAction={handleAdminAction} busy={busyId === r.id} activeRole={activeRole} />
              ))}
            </div>
          </Section>
        )}

        {inProgress.length > 0 && (
          <Section title="En progreso" count={inProgress.length}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inProgress.map(r => (
                <AdminCard key={r.id} request={r} busy={busyId === r.id} activeRole={activeRole} />
              ))}
            </div>
          </Section>
        )}

        {completedToday.length > 0 && (
          <Section title="Completadas hoy" count={completedToday.length}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {completedToday.map(r => (
                <AdminCard key={r.id} request={r} busy={busyId === r.id} activeRole={activeRole} />
              ))}
            </div>
          </Section>
        )}
      </div>

      {showCreate && (
        <CreateRequestModal
          branches={branches}
          isAdmin={activeRole === 'admin' || activeRole === 'owner'}
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

      {approveTarget && (
        <ApproveModal
          request={approveTarget}
          busy={busyId === approveTarget.id}
          onClose={() => setApproveTarget(null)}
          onSubmit={submitApprove}
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

const ApproveModal: React.FC<{
  request: ERPRequest;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}> = ({ request, busy, onClose, onSubmit }) => {
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Aprobar solicitud</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-zinc-400">{request.title}</p>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Justificación</span>
          <textarea
            rows={4}
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            placeholder="Explicá brevemente por qué la aprobás..."
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
              if (!note.trim()) { setErr('La justificación es obligatoria'); return; }
              setErr(null);
              await onSubmit(note.trim());
            }}
            disabled={busy}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Aprobar
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminRequestsView;
