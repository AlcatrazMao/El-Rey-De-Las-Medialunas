import { Trash2 } from 'lucide-react';
import React, { useMemo } from 'react';

import { useRequests } from '../hooks/useRequests';

import { RequestsView } from './RequestsView';
import { isToday } from './requests/shared';

export const MermasView: React.FC = () => {
  const { requests } = useRequests();

  const waste = useMemo(() => requests.filter(r => r.type === 'waste'), [requests]);

  const todayCount = useMemo(() => waste.filter(r =>
    isToday(r.created_at)
  ).length, [waste]);

  const pending = useMemo(() => waste.filter(r =>
    r.status === 'pending_approval'
  ).length, [waste]);

  const completedToday = useMemo(() => waste.filter(r =>
    r.status === 'completed' && isToday(r.updated_at ?? r.created_at)
  ).length, [waste]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Trash2 className="h-5 w-5 text-red-500" />
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Mermas</h1>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <KpiCard label="Hoy" value={todayCount} tone="red" />
          <KpiCard label="Pendientes" value={pending} tone="amber" />
          <KpiCard label="Completadas" value={completedToday} tone="emerald" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <RequestsView typeFilter="waste" />
      </div>
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: number; tone: 'red' | 'amber' | 'emerald' }> = ({ label, value, tone }) => {
  const colors = {
    red:     'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300',
    amber:   'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40 text-amber-700 dark:text-amber-300',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  };
  return (
    <div className={`rounded-xl border p-2.5 text-center ${colors[tone]}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
};

export default MermasView;
