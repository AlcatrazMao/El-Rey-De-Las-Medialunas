import {
  ClipboardList, ChefHat, Truck, Wrench, Package, Trash2,
} from 'lucide-react';
import React from 'react';

import type { RequestType } from '../../types';

// Forma única para los metadatos de tipo de solicitud: array ordenado (el orden
// importa para los <select> y la sub-nav) con lookup por `value`. Unifica lo que
// antes vivía como TYPE_OPTIONS (array) y TYPE_META/TYPE_COLOR (records) sueltos.
export interface TypeMeta {
  value: RequestType;
  label: string;
  icon: React.ReactNode;
  color: string;
}

export const TYPE_OPTIONS: TypeMeta[] = [
  { value: 'supply',      label: 'Insumos',     icon: <Package className="h-3 w-3" />,       color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'production',  label: 'Producción',  icon: <ChefHat className="h-3 w-3" />,       color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  { value: 'delivery',    label: 'Entrega',     icon: <Truck className="h-3 w-3" />,         color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'task',        label: 'Tarea',       icon: <ClipboardList className="h-3 w-3" />, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'maintenance', label: 'Mantenim.',   icon: <Wrench className="h-3 w-3" />,         color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  { value: 'waste',       label: 'Mermas',      icon: <Trash2 className="h-3 w-3" />,         color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  { value: 'custom',      label: 'Otro',        icon: <ClipboardList className="h-3 w-3" />, color: 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300' },
];

export function getTypeMeta(type: RequestType): TypeMeta {
  return TYPE_OPTIONS.find(t => t.value === type) ?? TYPE_OPTIONS[TYPE_OPTIONS.length - 1];
}

// Roles habilitados para resolver (aprobar/rechazar) solicitudes de tipo 'waste'
// (mermas) en el frontend. Un supervisor cuenta como admin-like para el resto de
// tipos, pero NO para mermas. El backend valida esto por separado (otro runtime).
export const WASTE_APPROVER_ROLES = ['admin', 'owner'];

export function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function formatRoleLabel(role: string): string {
  if (!role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function isToday(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

export const TypeFilterTab: React.FC<{
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}> = ({ label, icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
      active
        ? 'bg-amber-500 text-white border-amber-600'
        : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:border-amber-400'
    }`}
  >
    {icon}{label}
  </button>
);
