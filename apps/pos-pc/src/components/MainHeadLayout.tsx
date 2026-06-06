import React from 'react';
import { useApp } from '../AppContext';
import { NotificationCenter } from './NotificationCenter';
import {
  Sun,
  Moon,
  Monitor,
  Tablet,
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
    deviceMode,
    setDeviceMode,
    darkMode,
    setDarkMode,
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
                <Wifi className="h-2.5 w-2.5 animate-pulse" /> Sincronizado en Nube
              </span>
              <span className="text-[10px] text-gray-550 dark:text-zinc-500 font-medium">v2.4</span>
            </div>
          </div>
        </div>

        {/* Universal Controls bar */}
        <div className="flex flex-wrap items-center justify-center gap-3 w-full md:w-auto">
          {/* Emulated Device switcher with explanatory badge */}
          <div className="bg-gray-105 dark:bg-zinc-904 p-0.5 rounded-lg border border-gray-200 dark:border-zinc-800 flex items-center">
            <button
              id="btn-devmode-pc"
              onClick={() => setDeviceMode('PC')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                deviceMode === 'PC'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
              }`}
              title="Modo PC: Panel de administración completo y contabilidad"
            >
              <Monitor className="h-3.5 w-3.5" /> Computadora
            </button>
            <button
              id="btn-devmode-tablet"
              onClick={() => setDeviceMode('Tablet')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                deviceMode === 'Tablet'
                  ? 'bg-amber-500 text-white shadow-xs animate-pulse-slow'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
              }`}
              title="Modo Tablet/Caja: Punto de Venta (POS) simplificado estilo McDonald's"
            >
              <Tablet className="h-3.5 w-3.5" /> Tablet / Celular
            </button>
          </div>

          {/* User selector simulation */}
          <div className="relative group">
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-zinc-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer">
              <img
                src={activeUser.avatar}
                alt={activeUser.name}
                className="w-5 h-5 rounded-full object-cover border border-amber-300"
                referrerPolicy="no-referrer"
              />
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                {activeUser.name.split(' ')[0]} ({activeUser.role.toUpperCase()})
              </span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </div>

            {/* User switch dropdown content */}
            <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl shadow-xl hidden group-hover:block hover:block z-50 p-2">
              <p className="text-[10px] text-gray-400 dark:text-zinc-500 px-3 py-1 border-b border-gray-100 dark:border-zinc-850 font-bold tracking-wider uppercase mb-1">
                Cambiar de Operador
              </p>
              {users.map(u => (
                <button
                  key={u.id}
                  id={`btn-user-switch-${u.role}`}
                  onClick={() => setActiveUserRole(u.role)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2.5 transition-colors cursor-pointer ${
                    activeUser.id === u.id
                      ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 font-bold'
                      : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <img src={u.avatar} alt={u.name} className="w-5 h-5 rounded-full object-cover border border-gray-300 shrink-0" referrerPolicy="no-referrer" />
                  <div className="min-w-0">
                    <p className="truncate">{u.name.split(' ')[0]}</p>
                    <p className="text-[9px] text-gray-400 capitalize">{u.role === 'admin' ? 'Dueño / Admin' : u.role === 'cajero' ? 'Cajero de Turno' : 'Panadera Maestra'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Notification tray */}
          <NotificationCenter />

          {/* Dark Mode toggle button */}
          <button
            id="btn-dark-toggle"
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-full border border-gray-200 dark:border-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
            aria-label="Alternar Modo Oscuro"
          >
            {darkMode ? <Sun className="h-4.5 w-4.5 text-amber-400 animate-pulse" /> : <Moon className="h-4.5 w-4.5 text-zinc-600" />}
          </button>

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
            <RotateCcw className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
