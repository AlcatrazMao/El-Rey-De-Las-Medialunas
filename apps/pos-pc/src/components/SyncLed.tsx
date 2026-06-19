import * as React from 'react';

import type { SyncStatus } from '../types';

/**
 * LED de estado de sincronización con D1.
 * Colores:
 *   • synced  → verde  (#22c55e)
 *   • error   → amarillo (#eab308)  — hay errores pending
 *   • offline → rojo   (#ef4444)   — sin red
 * Cuando isSyncing está activo, pulsa.
 * El tooltip muestra el contador de errores pendientes.
 */
interface SyncLedProps {
  status: SyncStatus;
  onClick?: () => void;
}

const COLOR_BY_STATE: Record<SyncStatus['ledState'], string> = {
  synced: '#22c55e',
  error: '#eab308',
  offline: '#ef4444',
};

const LABEL_BY_STATE: Record<SyncStatus['ledState'], string> = {
  synced: 'Sincronizado',
  error: 'Errores de sincronización',
  offline: 'Sin conexión',
};

export const SyncLed: React.FC<SyncLedProps> = ({ status, onClick }) => {
  const color = COLOR_BY_STATE[status.ledState];
  const label = LABEL_BY_STATE[status.ledState];
  const count = status.pendingErrorCount;
  const tooltip = count > 0
    ? `${label} · ${count} ${count === 1 ? 'error pendiente' : 'errores pendientes'}`
    : label;

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      data-testid="sync-led"
      data-state={status.ledState}
      className="relative inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
    >
      <span className="relative inline-flex">
        {status.isSyncing && (
          <span
            className="absolute inset-0 inline-flex h-2 w-2 rounded-full opacity-75 animate-ping"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      </span>
      {count > 0 && (
        <span
          className="ml-1 text-[9px] font-black px-1 py-0.5 rounded-full"
          style={{ backgroundColor: color, color: 'white' }}
        >
          {count}
        </span>
      )}
    </button>
  );
};
