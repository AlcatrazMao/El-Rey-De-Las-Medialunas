import { Clock, CheckCircle2, X, Truck, PackageCheck, MapPin } from 'lucide-react';
import React from 'react';

import type { TransferOrder } from '../../types';

import { TransferStatusBadge } from './shared';

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Card de un transfer_order. Sigue el mismo look & feel que RequestCard
 * (components/RequestsView.tsx) y AdminCard (AdminRequestsView.tsx): borde
 * redondeado, header con badges, cuerpo con detalle, acciones condicionadas
 * por status + rol al pie.
 */
export const TransferCard: React.FC<{
  transfer: TransferOrder;
  /** admin/owner/supervisor: puede aprobar/rechazar un transfer 'pending'. */
  canApprove: boolean;
  /** Miembro de la sucursal de origen: puede despachar (ship) un transfer 'approved'. */
  canShip: boolean;
  /** Miembro de la sucursal de destino: puede recibir (receive) un transfer 'in_transit'. */
  canReceive: boolean;
  busy: boolean;
  onApprove: (t: TransferOrder) => void;
  onReject: (t: TransferOrder) => void;
  onShip: (t: TransferOrder) => void;
  onReceive: (t: TransferOrder) => void;
}> = ({ transfer, canApprove, canShip, canReceive, busy, onApprove, onReject, onShip, onReceive }) => {
  const totalQty = transfer.items.reduce((acc, it) => acc + it.quantity, 0);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-orange-100/40 dark:border-zinc-800 p-3 md:p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <TransferStatusBadge status={transfer.status} />
        <span className="text-[10px] text-gray-400 dark:text-zinc-500 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDate(transfer.created_at)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
        <MapPin className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="truncate">{transfer.source_branch_name ?? transfer.source_branch_id}</span>
        <span className="text-gray-400">→</span>
        <span className="truncate">{transfer.destination_branch_name ?? transfer.destination_branch_id}</span>
      </div>

      <div className="text-xs text-gray-500 dark:text-zinc-400">
        {transfer.items.length} producto{transfer.items.length === 1 ? '' : 's'} · {totalQty} unidad{totalQty === 1 ? '' : 'es'}
      </div>

      <ul className="text-[11px] text-gray-600 dark:text-zinc-300 space-y-0.5">
        {transfer.items.slice(0, 4).map(it => (
          <li key={it.id} className="flex justify-between">
            <span className="truncate">{it.product_name ?? it.product_id}</span>
            <span className="font-mono shrink-0 ml-2">
              {typeof it.received_quantity === 'number' ? `${it.received_quantity}/${it.quantity}` : it.quantity}
            </span>
          </li>
        ))}
        {transfer.items.length > 4 && (
          <li className="text-gray-400">+{transfer.items.length - 4} más…</li>
        )}
      </ul>

      {transfer.notes && (
        <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic line-clamp-2">{transfer.notes}</p>
      )}

      {transfer.rejection_reason && (
        <div className="text-[11px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded p-1.5">
          <strong>Rechazado:</strong> {transfer.rejection_reason}
        </div>
      )}

      {transfer.status === 'pending' && canApprove && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onApprove(transfer)}
            disabled={busy}
            className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
          </button>
          <button
            onClick={() => onReject(transfer)}
            disabled={busy}
            className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Rechazar
          </button>
        </div>
      )}

      {transfer.status === 'approved' && canShip && (
        <button
          onClick={() => onShip(transfer)}
          disabled={busy}
          className="w-full px-3 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Truck className="h-3.5 w-3.5" /> Marcar como enviado
        </button>
      )}

      {transfer.status === 'in_transit' && canReceive && (
        <button
          onClick={() => onReceive(transfer)}
          disabled={busy}
          className="w-full px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <PackageCheck className="h-3.5 w-3.5" /> Marcar como recibido
        </button>
      )}
    </div>
  );
};

export default TransferCard;
