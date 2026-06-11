import { Users, Key } from 'lucide-react';
import * as React from 'react'
import { useRef, useState } from 'react';

const ADMIN_URL = 'https://admin-users-production.elprincipitodeargentina.workers.dev';

export const AdminUsersView: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [secret, setSecret] = useState(() => sessionStorage.getItem('admin_secret') || '');
  const [showConfig, setShowConfig] = useState(!sessionStorage.getItem('admin_secret'));
  const [inputValue, setInputValue] = useState('');

  // Send auth to iframe once it loads
  const sendAuth = () => {
    const key = secret || inputValue;
    if (!key || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ type: 'auth', secret: key }, ADMIN_URL);
    if (!secret) {
      sessionStorage.setItem('admin_secret', key);
      setSecret(key);
      setShowConfig(false);
    }
  };

  // Retry on iframe load
  const handleLoad = () => {
    if (secret) {
      setTimeout(sendAuth, 500);
    }
  };

  if (showConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Key className="w-12 h-12 text-amber-500 mb-4" />
        <h3 className="text-lg font-bold text-gray-800 dark:text-zinc-100 mb-2">Clave de Administración</h3>
        <p className="text-sm text-gray-500 mb-4">Ingresá la clave del panel de usuarios</p>
        <div className="flex gap-2">
          <input type="password" value={inputValue} onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendAuth()}
            placeholder="Clave de admin"
            className="px-4 py-2 border rounded-xl text-sm w-56" />
          <button onClick={sendAuth} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-bold">Conectar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <Users className="w-6 h-6 text-amber-500" />
        <h2 className="text-lg font-bold text-gray-800 dark:text-zinc-100">Administrar Usuarios</h2>
        <button onClick={() => { sessionStorage.removeItem('admin_secret'); setSecret(''); setShowConfig(true); }}
          className="ml-auto text-xs text-gray-400 hover:text-red-500">Cambiar clave</button>
      </div>
      <iframe
        ref={iframeRef}
        src={ADMIN_URL}
        onLoad={handleLoad}
        className="flex-1 w-full rounded-xl border border-gray-200 dark:border-zinc-800"
        style={{ minHeight: '70vh' }}
        title="Admin Users"
      />
    </div>
  );
};
