import { CreditCard, CheckCircle, Circle } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import { useApp } from '../AppContext';
import type {
  AppSettings,
  GatewayCredential,
  PaymentMethodConfig,
  PaymentAdjustmentType,
  DiscountConfig,
} from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onUpdate: (credentials: GatewayCredential[]) => void;
  onSaved: () => void;
  setPaymentMethods: (paymentMethods: PaymentMethodConfig[]) => void;
  setDiscountConfig: (discountConfig: DiscountConfig) => void;
}

const GATEWAY_META: Record<string, { name: string; logo: string; chargeFee: number }> = {
  gate_stripe: { name: 'Stripe', logo: '💳', chargeFee: 2.9 },
  gate_mp: { name: 'Mercado Pago', logo: '🤝', chargeFee: 3.4 },
  gate_paypal: { name: 'PayPal Express', logo: '🌐', chargeFee: 3.9 },
};

export const PaymentSettings: React.FC<Props> = ({ settings, onUpdate, onSaved, setPaymentMethods, setDiscountConfig }) => {
  const { gateways } = useApp();

  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    settings.gatewayCredentials.forEach(gc => { map[gc.gatewayId] = gc.publicKey; });
    return map;
  });

  const [testToast, setTestToast] = useState<string | null>(null);
  const [paymentMethods, setLocalPaymentMethods] = useState<PaymentMethodConfig[]>(() => settings.paymentMethods ?? []);
  const [discountPercents, setDiscountPercents] = useState<number[]>(() => settings.discountConfig?.availablePercents ?? [5, 10, 15, 20, 25, 30]);
  const [allowManual, setAllowManual] = useState(() => settings.discountConfig?.allowManualDiscount ?? false);
  const [newPercent, setNewPercent] = useState('');

  const handleTestConnection = (gatewayId: string) => {
    const meta = GATEWAY_META[gatewayId];
    setTestToast(`Test de conexión con ${meta?.name ?? gatewayId}: Próximamente disponible`);
    setTimeout(() => setTestToast(null), 3000);
  };

  const handleSavePaymentConfig = () => {
    setPaymentMethods(paymentMethods);
    setDiscountConfig({ availablePercents: discountPercents, allowManualDiscount: allowManual });
    onSaved();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: GatewayCredential[] = Object.entries(credentials)
      .filter(([, key]) => key.trim() !== '')
      .map(([gatewayId, publicKey]) => ({ gatewayId, publicKey: publicKey.trim() }));
    onUpdate(updated);
    onSaved();
  };

  const updatePm = (idx: number, patch: Partial<PaymentMethodConfig>) => {
    setLocalPaymentMethods(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const clampPercent = (raw: string): number => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n > 99.99) return 99.99;
    return parseFloat(n.toFixed(2));
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

      <div className="border-t border-gray-100 dark:border-zinc-800 pt-5 space-y-4">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-extrabold text-gray-700 dark:text-zinc-200 uppercase tracking-wider">Métodos de Pago</h4>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-zinc-400 leading-relaxed">
          Configurá cómo se comporta cada método al cobrar: si está habilitado, qué ajuste automático aplica sobre el total, y si admite acumular descuentos manuales o de lista de precios.
        </p>
        <div className="space-y-3">
          {paymentMethods.map((pm, idx) => {
            const showPercent = pm.adjustmentType !== 'none';
            return (
              <div
                key={pm.id}
                className="bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl shrink-0">{pm.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-gray-800 dark:text-zinc-100">{pm.label}</p>
                    <p className="text-[10px] text-gray-400 font-medium">ID: <span className="font-mono">{pm.id}</span></p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Habilitado</span>
                    <input
                      type="checkbox"
                      checked={pm.enabled}
                      onChange={e => updatePm(idx, { enabled: e.target.checked })}
                      className="rounded text-amber-500 border-gray-300 focus:ring-amber-500 h-4 w-4"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                      Tipo de ajuste
                    </label>
                    <select
                      value={pm.adjustmentType}
                      onChange={e => updatePm(idx, { adjustmentType: e.target.value as PaymentAdjustmentType })}
                      className="w-full text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                    >
                      <option value="none">Ninguno</option>
                      <option value="recargo">Recargo (%)</option>
                      <option value="descuento">Descuento (%)</option>
                    </select>
                  </div>

                  {showPercent && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                        Porcentaje
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="99.99"
                          step="0.01"
                          value={pm.adjustmentPercent}
                          onChange={e => updatePm(idx, { adjustmentPercent: clampPercent(e.target.value) })}
                          className="flex-1 text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                        />
                        <span className="text-xs font-extrabold text-gray-500">%</span>
                      </div>
                    </div>
                  )}
                </div>

                <label className="flex items-center justify-between gap-3 px-3 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl cursor-pointer">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-gray-700 dark:text-zinc-200">Acumula descuentos</p>
                    <p className="text-[10px] text-gray-500 dark:text-zinc-400 leading-tight">
                      Si está apagado, este método ignora descuentos manuales y de lista de precios.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={pm.acumulaDescuentos}
                    onChange={e => updatePm(idx, { acumulaDescuentos: e.target.checked })}
                    className="rounded text-amber-500 border-gray-300 focus:ring-amber-500 h-4 w-4 shrink-0"
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-zinc-800 pt-5 space-y-4">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-extrabold text-gray-700 dark:text-zinc-200 uppercase tracking-wider">Porcentajes de Descuento Disponibles</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          {discountPercents.map(pct => (
            <span
              key={pct}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 text-xs font-extrabold rounded-lg"
            >
              -{pct}%
              <button
                type="button"
                onClick={() => setDiscountPercents(prev => prev.filter(p => p !== pct))}
                className="text-emerald-500 hover:text-red-500 ml-0.5 cursor-pointer font-black"
              >×</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="99"
            value={newPercent}
            onChange={e => setNewPercent(e.target.value)}
            placeholder="Ej: 15"
            className="w-24 text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={() => {
              const val = parseInt(newPercent, 10);
              if (!isNaN(val) && val > 0 && val < 100 && !discountPercents.includes(val)) {
                setDiscountPercents(prev => [...prev, val].sort((a, b) => a - b));
                setNewPercent('');
              }
            }}
            className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer"
          >
            + Agregar
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="allow-manual-discount"
            type="checkbox"
            checked={allowManual}
            onChange={e => setAllowManual(e.target.checked)}
            className="rounded text-amber-500 border-gray-300 focus:ring-amber-500 h-3.5 w-3.5"
          />
          <label htmlFor="allow-manual-discount" className="text-xs font-bold text-gray-600 dark:text-zinc-400 cursor-pointer">
            Permitir descuento manual (ingreso libre de porcentaje)
          </label>
        </div>
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={(e) => { handleSubmit(e as unknown as React.FormEvent); handleSavePaymentConfig(); }}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          Guardar cambios
        </button>
      </div>
    </form>
  );
};
