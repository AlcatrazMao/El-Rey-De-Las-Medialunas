import { X, Loader2 } from 'lucide-react';
import React, { useState } from 'react';

import type { TransferOrder } from '../../types';

// Mismo shape que ReasonModal en components/RequestsView.tsx — motivo obligatorio.
export const RejectTransferModal: React.FC<{
  transfer: TransferOrder;
  onClose: () => void;
  onReject: (id: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
}> = ({ transfer, onClose, onReject, onDone }) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) { setErr('El motivo es obligatorio'); return; }
    setSubmitting(true);
    setErr(null);
    const result = await onReject(transfer.id, reason.trim());
    setSubmitting(false);
    if (!result.ok) { setErr(result.error ?? 'No se pudo rechazar'); return; }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Rechazar traslado</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          {transfer.source_branch_name ?? transfer.source_branch_id} → {transfer.destination_branch_name ?? transfer.destination_branch_id}
        </p>
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
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
};

export default RejectTransferModal;
