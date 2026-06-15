import { CreditCard, CheckCircle, Circle } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import { useApp } from '../AppContext';
import type { AppSettings, GatewayCredential } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (credentials: GatewayCredential[]) => void;
  onSaved: () => void;
}

const GATEWAY_META: Record<string, { name: string; logo: string; chargeFee: number }> = {
  gate_stripe: { name: 'Stripe', logo: '💳', chargeFee: 2.9 },
  gate_mp: { name: 'Mercado Pago', logo: '🤝', chargeFee: 3.4 },
  gate_paypal: { name: 'PayPal Express', logo: '🌐', chargeFee: 3.9 },
};

export const PaymentSettings: React.FC<Props> = ({ settings, onUpdate, onSaved }) => {
  const { gateways } = useApp();

  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    settings.gatewayCredentials.forEach(gc => { map[gc.gatewayId] = gc.publicKey; });
    return map;
  });

  const [testToast, setTestToast] = useState<string | null>(null);

  const handleTestConnection = (gatewayId: string) => {
    const meta = GATEWAY_META[gatewayId];
    setTestToast(`Test de conexión con ${meta?.name ?? gatewayId}: Próximamente disponible`);
    setTimeout(() => setTestToast(null), 3000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: GatewayCredential[] = Object.entries(credentials)
      .filter(([, key]) => key.trim() !== '')
      .map(([gatewayId, publicKey]) => ({ gatewayId, publicKey: publicKey.trim() }));
    onUpdate(updated);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
        <CreditCard className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-50">Pasarelas de Pago</h3>
      </div>

      {testToast && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-bold px-4 py-2.5 rounded-xl">
          {testToast}
        </div>
      )}

      <div className="space-y-4">
        {gateways.map(gw => {
          const meta = GATEWAY_META[gw.id];
          const currentKey = credentials[gw.id] ?? '';
          const isConfigured = currentKey.trim() !== '';

          return (
            <div key={gw.id} className="bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{meta?.logo ?? '💳'}</span>
                  <div>
                    <p className="text-xs font-extrabold text-gray-800 dark:text-zinc-100">{gw.name}</p>
                    <p className="text-[10px] text-gray-400">Comisión: {meta?.chargeFee ?? gw.chargeFee}% por transacción</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {isConfigured
                    ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    : <Circle className="h-3.5 w-3.5 text-gray-300" />
                  }
                  <span className={`text-[10px] font-bold ${isConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                    {isConfigured ? 'Configurado' : 'Sin configurar'}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                  Public Key
                </label>
                <input
                  type="text"
                  value={currentKey}
                  onChange={e => setCredentials(prev => ({ ...prev, [gw.id]: e.target.value }))}
                  placeholder={`pk_live_...`}
                  className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100 font-mono"
                />
              </div>

              <button
                type="button"
                onClick={() => handleTestConnection(gw.id)}
                className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                Probar conexión →
              </button>
            </div>
          );
        })}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          Guardar cambios
        </button>
      </div>
    </form>
  );
};
