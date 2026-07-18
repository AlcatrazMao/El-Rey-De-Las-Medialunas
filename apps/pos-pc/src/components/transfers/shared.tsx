import React from 'react';

import type { TransferOrderStatus } from '../../types';

// Mismo patrón que components/requests/shared.tsx: metadata de status como
// lookup, para que las cards y el listado no repitan los mismos objetos.
export const STATUS_META: Record<TransferOrderStatus, { label: string; cls: string }> = {
  pending:     { label: 'Pendiente aprobación', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved:    { label: 'Aprobado',             cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  rejected:    { label: 'Rechazado',            cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  in_transit:  { label: 'En tránsito',          cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  received:    { label: 'Recibido',             cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  completed:   { label: 'Completado',           cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

export function getStatusMeta(status: TransferOrderStatus) {
  return STATUS_META[status] ?? { label: status, cls: 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300' };
}

export const TransferStatusBadge: React.FC<{ status: TransferOrderStatus }> = ({ status }) => {
  const meta = getStatusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
      {meta.label}
    </span>
  );
};
