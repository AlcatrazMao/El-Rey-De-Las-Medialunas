import React from 'react';
import { useApp } from '../AppContext';
import { Globe, CreditCard, ShieldCheck, KeyRound, Check, HelpCircle, EyeOff } from 'lucide-react';

export const IntegrationsView: React.FC = () => {
  const { gateways, toggleGateway } = useApp();

  return (
    <div className="space-y-6 transition-all duration-300">
      
      {/* SECTION HEADER */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between border-b pb-4 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <Globe className="h-5 w-5 text-amber-500" /> Pasarelas de Pago e Integraciones del ERP
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Habilita o suspende el procesamiento de cobros electrónicos para tu mostrador panadero en tiempo real.
          </p>
        </div>
      </div>

      {/* QUICK INSTRUCTION ALERT */}
      <div className="p-4 bg-amber-50/50 dark:bg-amber-950/15 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl flex gap-3">
        <HelpCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 dark:text-amber-350 font-medium">
          <p className="font-bold">Guía de Conectividad con la Nube:</p>
          <p className="mt-1 leading-relaxed">
            Las pasarelas integradas operan en modo Sandbox (Simulación) para prevenir cargos económicos reales en tus pruebas con el ERP. Para habilitar producción, configure las variables secretas secret en su panel administrativo de Google AI Studio e inserte sus token de API correspondientes.
          </p>
        </div>
      </div>

      {/* GATEWAYS CONTROL CARDS LIST */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {gateways.map(gate => {
          const isActive = gate.status === 'active';
          
          let colorTheme = { border: 'border-orange-105', headerBg: 'bg-indigo-600', text: 'text-indigo-600', icon: '💳' };
          if (gate.id === 'gate_mp') {
            colorTheme = { border: 'border-sky-105', headerBg: 'bg-sky-500', text: 'text-sky-550', icon: '🤝' };
          } else if (gate.id === 'gate_paypal') {
            colorTheme = { border: 'border-blue-105', headerBg: 'bg-blue-600', text: 'text-blue-600', icon: '🌐' };
          }

          return (
            <div
              key={gate.id}
              className={`bg-white dark:bg-zinc-900 border rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between transition-all duration-300 ${
                isActive 
                  ? 'border-amber-200 dark:border-amber-900/60 ring-1 ring-amber-100 dark:ring-amber-950/20' 
                  : 'border-gray-200 dark:border-zinc-800'
              }`}
            >
              <div>
                {/* Header brand tag */}
                <div className={`p-4 ${colorTheme.headerBg} text-white flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{colorTheme.icon}</span>
                    <span className="font-extrabold text-sm">{gate.name}</span>
                  </div>
                  <span className="text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/20">
                    {gate.id.split('_')[1].toUpperCase()} CONNECT
                  </span>
                </div>

                {/* Body details */}
                <div className="p-5 space-y-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500 font-semibold">Tasa / Comisión Operador:</span>
                    <span className="font-extrabold text-gray-800 dark:text-zinc-200">{gate.chargeFee}% por transacción</span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500 font-semibold">Estado en Mostrador:</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      isActive 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400' 
                        : 'bg-gray-105 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {isActive ? '● CONECTADO' : '○ APAGADO'}
                    </span>
                  </div>

                  {/* Secret credential guidance lines */}
                  <div className="border-t pt-4 border-gray-100 dark:border-zinc-800 space-y-2">
                    <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <KeyRound className="h-3.5 w-3.5 text-zinc-400" /> Credenciales Corporativas
                    </p>

                    <div className="space-y-1 bg-gray-50 dark:bg-zinc-950/30 p-2.5 rounded-xl border border-gray-100 dark:border-zinc-850 font-mono text-[9px]">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span className="truncate">PUBL_KEY = pk_live_***95a</span>
                        <HelpCircle className="h-3 w-3 cursor-help text-zinc-405 shrink-0" title="Identificador de cuenta productora" />
                      </div>
                      <div className="flex items-center justify-between text-zinc-400 mt-1">
                        <span className="truncate flex items-center gap-1"><EyeOff className="h-3 w-3 opacity-60" /> SECR_KEY = ••••••••••••••••</span>
                        <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toggle processor state action button */}
              <div className="p-4 bg-gray-50 dark:bg-zinc-950 border-t border-gray-100 dark:border-zinc-800 select-none">
                <button
                  id={`btn-toggle-gate-${gate.id}`}
                  onClick={() => toggleGateway(gate.id)}
                  className={`w-full py-2 rounded-xl text-xs font-bold transition-all border shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-red-50 hover:bg-red-500 hover:text-white border-red-200 dark:border-red-950/20 text-red-650'
                      : 'bg-amber-500 hover:bg-amber-600 border-transparent text-white'
                  }`}
                >
                  {isActive ? 'Suspender Pasarela en POS' : 'Habilitar Cobros con esta Vía'}
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* SECURITY BANNER */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-500 rounded-xl">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h4 className="font-extrabold text-sm text-gray-850 dark:text-zinc-50">Cifrado de Extremo a Extremo Activo (SSL / TLS 1.3)</h4>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
            Las API invocadas utilizan tokens cruzados con protección de Sandbox certificado por PCI-DSS. Ningún dato bancario de tarjeta se almacena localmente preservando la seguridad plena del cliente.
          </p>
        </div>
      </div>

    </div>
  );
};
