import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { Bell, Check, Trash2, CircleAlert, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export const NotificationCenter: React.FC = () => {
  const { notifications, markNotificationAsRead, clearNotifications } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'error':
        return { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-900', text: 'text-red-800 dark:text-red-300', icon: <CircleAlert className="h-5 w-5 text-red-500" /> };
      case 'warning':
        return { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900', text: 'text-amber-800 dark:text-amber-300', icon: <AlertTriangle className="h-5 w-5 text-amber-500" /> };
      case 'success':
        return { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900', text: 'text-emerald-800 dark:text-emerald-300', icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" /> };
      default:
        return { bg: 'bg-sky-50 dark:bg-sky-950/30', border: 'border-sky-200 dark:border-sky-900', text: 'text-sky-800 dark:text-sky-300', icon: <Info className="h-5 w-5 text-sky-500" /> };
    }
  };

  return (
    <div className="relative z-50">
      <button
        id="btn-bell-notif"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full cursor-pointer transition-all duration-200 text-gray-600 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-950/40"
        aria-label="Abrir centro de notificaciones"
      >
        <Bell className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-500 rounded-full animate-bounce">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-100 dark:border-zinc-800 p-4 transition-all duration-300">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
            <h3 className="font-semibold text-gray-800 dark:text-zinc-100 flex items-center gap-2">
              <Bell className="h-4 w-4" /> Notificaciones Críticas ({unreadCount} sin leer)
            </h3>
            {notifications.length > 0 && (
              <button
                id="btn-clear-notifications"
                onClick={clearNotifications}
                className="text-xs flex items-center gap-1 text-gray-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 cursor-pointer transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Limpiar Todo
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto mt-2 space-y-2 pr-1">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-gray-400 dark:text-zinc-500">
                <Bell className="h-8 w-8 mx-auto opacity-30 mb-2" />
                <p className="text-sm">No hay notificaciones activas</p>
              </div>
            ) : (
              notifications.map(notif => {
                const style = getTypeStyle(notif.type);
                return (
                  <div
                    key={notif.id}
                    className={`p-3 rounded-lg border flex gap-3 relative transition-all duration-200 ${style.bg} ${style.border} ${notif.read ? 'opacity-70' : 'opacity-100 border-l-4 border-l-amber-500'}`}
                  >
                    <div className="mt-0.5 shrink-0">{style.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-1">
                        <p className={`font-medium text-xs md:text-sm ${style.text}`}>
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <button
                            id={`btn-read-${notif.id}`}
                            onClick={() => markNotificationAsRead(notif.id)}
                            className="bg-white/80 dark:bg-zinc-800/80 p-0.5 rounded border border-gray-200 dark:border-zinc-700 hover:bg-emerald-500 hover:text-white dark:hover:bg-emerald-600 cursor-pointer transition-colors shrink-0"
                            title="Marcar como leída"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-zinc-300 mt-1">
                        {notif.message}
                      </p>
                      <span className="text-[10px] text-gray-400 dark:text-zinc-500 mt-1 block">
                        {new Date(notif.timestamp).toLocaleString('es-AR')}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          <div className="mt-3 pt-2 text-[10px] text-gray-400 border-t border-gray-100 dark:border-zinc-800 text-center">
            Pulsación del sonido habilitada • Monitoreo sincronizado
          </div>
        </div>
      )}
    </div>
  );
};
