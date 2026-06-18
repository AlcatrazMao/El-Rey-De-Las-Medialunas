import { Users } from 'lucide-react';
import * as React from 'react'
import { useRef, useState, useEffect } from 'react';

const ADMIN_URL = 'https://admin-users-production.elprincipitodeargentina.workers.dev';

export const AdminUsersView: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Listen for messages from the iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ADMIN_READY') {
        const token = sessionStorage.getItem('access_token');
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'AUTH_TOKEN', token },
          ADMIN_URL
        );
        setIframeReady(true);
      }
      if (event.data?.type === 'AUTH_ERROR') {
        setIframeError(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Timeout: if iframe doesn't signal ready in 10 seconds, show error
  useEffect(() => {
    if (iframeReady || iframeError) return;
    const t = setTimeout(() => setIframeError(true), 10000);
    return () => clearTimeout(t);
  }, [iframeReady, iframeError]);

  const handleRetry = () => {
    setIframeError(false);
    setIframeReady(false);
    setIframeKey(k => k + 1);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <Users className="w-6 h-6 text-amber-500" />
        <h2 className="text-lg font-bold text-gray-800 dark:text-zinc-100">Administrar Usuarios</h2>
      </div>
      <div className="relative flex-1" style={{ minHeight: '70vh' }}>
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={ADMIN_URL}
          className="w-full h-full rounded-2xl border border-gray-200 dark:border-zinc-800"
          title="Admin Users"
        />
        {!iframeReady && !iframeError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-zinc-900 rounded-2xl gap-3">
            <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            <p className="text-xs font-bold text-gray-500 dark:text-zinc-400">Conectando con panel de administración...</p>
          </div>
        )}
        {iframeError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-zinc-900 rounded-2xl gap-3">
            <p className="text-xs font-bold text-red-500">No se pudo conectar con el panel de administración</p>
            <p className="text-[10px] text-gray-400">Verificá que el servicio esté activo o revisá tu conexión</p>
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
