import React from 'react';
import { Users } from 'lucide-react';

const ADMIN_URL = 'https://admin-users-production.elprincipitodeargentina.workers.dev';
// Auto-login via URL hash - no manual password needed inside iframe
const ADMIN_AUTH = 'ReyAlcatraz2026';

export const AdminUsersView: React.FC = () => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <Users className="w-6 h-6 text-amber-500" />
        <h2 className="text-lg font-bold text-gray-800 dark:text-zinc-100">Administrar Usuarios</h2>
      </div>
      <iframe
        src={`${ADMIN_URL}#auth=${encodeURIComponent(ADMIN_AUTH)}`}
        className="flex-1 w-full rounded-xl border border-gray-200 dark:border-zinc-800"
        style={{ minHeight: '70vh' }}
        title="Admin Users"
      />
    </div>
  );
};
