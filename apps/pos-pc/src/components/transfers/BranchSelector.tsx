import { MapPin } from 'lucide-react';
import React from 'react';

import { useApp } from '../../AppContext';

/**
 * Selector de sucursal activa (multi-branch transfers, fase 3). Solo se
 * renderiza para roles con `canSelectBranch` (admin/owner/supervisor) — el
 * resto de los roles queda fijo en su default_branch y ni siquiera monta este
 * componente (ver App.tsx). Cambiar la sucursal acá actualiza activeBranchId
 * en AppContext, que a su vez propaga el header X-Branch-Id (services/api.ts)
 * a todos los requests salientes.
 */
export const BranchSelector: React.FC = () => {
  const { canSelectBranch, availableBranches, activeBranchId, setActiveBranchId } = useApp();

  if (!canSelectBranch || availableBranches.length <= 1) return null;

  return (
    <label className="flex items-center gap-1.5 text-xs py-1.5 px-2.5 bg-amber-500/5 dark:bg-amber-950/10 border border-amber-500/10 dark:border-zinc-800 rounded-xl cursor-pointer">
      <MapPin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
      <select
        value={activeBranchId ?? ''}
        onChange={e => setActiveBranchId(e.target.value)}
        className="bg-transparent text-xs font-bold text-gray-700 dark:text-zinc-300 focus:outline-none cursor-pointer"
        aria-label="Sucursal activa"
      >
        {availableBranches.map(b => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
    </label>
  );
};

export default BranchSelector;
