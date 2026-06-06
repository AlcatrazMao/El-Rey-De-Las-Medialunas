import React from 'react';
import { useApp } from '../AppContext';
import { NotificationCenter } from './NotificationCenter';
import {
  Users,
  RotateCcw,
  Wifi,
  CloudLightning,
  ChevronDown
} from 'lucide-react';
import { UserRole } from '../types';

export const MainHeadLayout: React.FC = () => {
  const {
    activeUser,
    setActiveUserRole,
    resetAllData,
    users
  } = useApp();

  return (
    <header className="bg-gray-100 dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-800 px-4 py-3 shadow-sm transition-all duration-300">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Brand logo */}
        <div className="flex items-center gap-3">
          <div className="bg-amber-100 dark:bg-amber-950/20 p-2 rounded-xl border border-gray-200 dark:border-zinc-800 transition-transform hover:scale-105">
            <span className="text-2xl" role="img" aria-label="croissant">🥐</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-amber-700 dark:text-zinc-50 flex items-center gap-1.5 font-serif">
              Miga & Horno <span className="text-amber-500 dark:text-amber-400 font-extrabold italic font-sans text-sm">Trigo de Oro</span>
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-500/10 dark:bg-emerald-950/20 dark:text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Online
              </span>
              <NotificationCenter />
            </div>
          </div>
        </div>

        {/* Universal Controls bar */}
        <div className="flex flex-wrap items-center justify-center gap-3 w-full md:w-auto">
          {/* User selector simulation */}
          <div className="relative group">
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-zinc-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer">
              <img
                src={activeUser.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(activeUser.name)}&background=8B5E3C&color=fff&bold=true`}
                alt={activeUser.name}
                className="w-6 h-6 rounded-full object-cover border border-amber-500/30"
              />
              <span className="text-sm font-semibold text-gray-700 dark:text-zinc-200 truncate max-w-[120px]">{activeUser.name}</span>
              <span className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md uppercase font-black tracking-wider">{activeUser.role}</span>
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            </div>

            {/* Dropdown list of users */}
            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 p-2">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => setActiveUserRole(u.role)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors text-left ${
                    activeUser.id === u.id
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <img
                    src={u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=8B5E3C&color=fff&bold=true`}
                    alt={u.name}
                    className="w-6 h-6 rounded-full object-cover border border-gray-200 dark:border-zinc-700"
                  />
                  <div className="flex-1 text-left">
                    <div className="font-bold">{u.name}</div>
                    <div className="text-[9px] text-gray-400 dark:text-zinc-500 uppercase tracking-wider">{u.role}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* System reset */}
          <button
            id="btn-system-reset"
            onClick={() => {
              if (window.confirm('¿Estás seguro de que deseas reiniciar todos los datos a los valores por defecto? Se perderán las ventas del día.')) {
                resetAllData();
              }
            }}
            className="p-2 rounded-full border border-gray-200 dark:border-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/20 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer"
            title="Restablecer base de datos del ERP"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
