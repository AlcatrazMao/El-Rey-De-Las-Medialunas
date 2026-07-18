import { ArrowLeftRight, Plus, RefreshCw, Inbox, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useMemo } from 'react';

import { useApp } from '../../AppContext';
import { useTransfers } from '../../hooks/useTransfers';
import { API_URL, fetchWithAuth } from '../../services/api';
import type { Branch } from '../requests/CreateRequestModal';

import { CreateTransferModal } from './CreateTransferModal';
import { RejectTransferModal } from './RejectTransferModal';
import { TransferCard } from './TransferCard';

/**
 * Panel de traslados entre sucursales (multi-branch transfers, fase 3).
 * Sigue la misma estructura que AdminRequestsView/RequestsView: header con
 * refresh + crear, listado en grid de cards, modales para acciones que
 * requieren un motivo (rechazo).
 *
 * Reglas de rol (server-side ya las aplica; acá solo condicionamos qué
 * botones se muestran, para UX — el backend es quien realmente autoriza):
 *  - admin/owner/supervisor: aprobar/rechazar cualquier transfer pending.
 *  - cualquier usuario de la sucursal de ORIGEN: puede marcar como enviado.
 *  - cualquier usuario de la sucursal de DESTINO: puede marcar como recibido.
 *  - crear: cualquier usuario (el backend fuerza source_branch_id si es
 *    operativo); el selector de origen solo aparece para roles elevados.
 */
export const TransfersView: React.FC = () => {
  const { activeUser, addSystemNotification, activeBranchId, canSelectBranch, availableBranches } = useApp();
  const {
    transfers, loading, error, refetch,
    createTransfer, approveTransfer, rejectTransfer, shipTransfer, receiveTransfer,
  } = useTransfers();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Parameters<typeof RejectTransferModal>[0]['transfer'] | null>(null);

  const role = (activeUser?.role ?? '') as string;
  const isElevated = role === 'admin' || role === 'owner' || role === 'supervisor';

  // Mismo patrón que AdminRequestsView: cargar el catálogo de sucursales al
  // montar (usado para los <select> del modal de creación).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/v1/branches?limit=100`);
        if (!res.ok) return;
        const data = (await res.json()) as { success?: boolean; data?: Branch[] };
        if (!cancelled && Array.isArray(data?.data)) setBranches(data.data);
      } catch {
        // el form de creación puede quedar sin nombres, solo ids — degrada bien
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Sucursales seleccionables en el modal de creación: para roles elevados,
  // el universo completo de branches cargadas; si no hay branches[] resuelto
  // aún, cae a la lista completa igual (mejor mostrar de más que bloquear).
  const selectableBranches = useMemo(() => {
    if (!canSelectBranch) return branches;
    if (availableBranches.length === 0) return branches;
    return branches.filter(b => availableBranches.includes(b.id));
  }, [branches, canSelectBranch, availableBranches]);

  const runAction = async (id: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusyId(id);
    try {
      const result = await action();
      if (!result.ok) {
        addSystemNotification('Error', result.error ?? 'Acción fallida', 'error');
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !transfers.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-xs mt-2">Cargando traslados…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5 text-amber-500" />
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Traslados entre sucursales</h1>
          {transfers.length > 0 && (
            <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{transfers.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
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
            <Plus className="h-3.5 w-3.5" /> Nuevo traslado
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-xs px-4 py-1.5 border-b border-amber-200 dark:border-amber-900/40">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!transfers.length && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-zinc-600 gap-3">
            <Inbox className="h-12 w-12" />
            <p className="text-sm font-medium">No hay traslados registrados</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {transfers.map(t => (
            <TransferCard
              key={t.id}
              transfer={t}
              canApprove={isElevated}
              // Un usuario puede despachar/recibir si su sucursal activa coincide
              // con origen/destino. Para roles elevados con selector, esto sigue
              // el mismo criterio: activeBranchId es "la sucursal que estoy operando".
              canShip={!!activeBranchId && activeBranchId === t.source_branch_id}
              canReceive={!!activeBranchId && activeBranchId === t.destination_branch_id}
              busy={busyId === t.id}
              onApprove={(tr) => void runAction(tr.id, () => approveTransfer(tr.id))}
              onReject={(tr) => setRejectTarget(tr)}
              onShip={(tr) => void runAction(tr.id, () => shipTransfer(tr.id))}
              onReceive={(tr) => void runAction(tr.id, () => receiveTransfer(tr.id))}
            />
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateTransferModal
          branches={selectableBranches}
          onClose={() => setShowCreate(false)}
          onCreate={createTransfer}
          onCreated={() => {
            setShowCreate(false);
            addSystemNotification('Traslado creado', 'El traslado quedó pendiente de aprobación.', 'success');
          }}
        />
      )}

      {rejectTarget && (
        <RejectTransferModal
          transfer={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onReject={rejectTransfer}
          onDone={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
};

export default TransfersView;
