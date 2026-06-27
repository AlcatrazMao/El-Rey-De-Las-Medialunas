import { ScanBarcode, Trash2, Package } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

import { useApp } from '../AppContext';
import { formatCurrency } from '../utils/format';

interface PreviewLine {
  name: string;
  code: string;
  price: number;
  qty: number;
}

export const MaintenanceSettings: React.FC = () => {
  const { products } = useApp();
  const [isScanning, setIsScanning] = useState(false);
  const [previewCart, setPreviewCart] = useState<PreviewLine[]>([]);
  const [lastLog, setLastLog] = useState<string | null>(null);

  const playBeep = (freq = 880, duration = 0.08) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.addEventListener('ended', () => ctx.close().catch(() => {}));
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch { /* audio blocked */ }
  };

  const handleTestScan = () => {
    if (isScanning || products.length === 0) return;
    setIsScanning(true);
    playBeep(350, 0.1);
    setTimeout(() => {
      const random = products[Math.floor(Math.random() * products.length)];
      if (random) {
        setPreviewCart(prev => {
          const existing = prev.find(l => l.code === random.code);
          if (existing) return prev.map(l => l.code === random.code ? { ...l, qty: l.qty + 1 } : l);
          return [...prev, { name: random.name, code: random.code, price: random.price, qty: 1 }];
        });
        setLastLog(`✅ Código leído: ${random.code} → ${random.name}`);
        playBeep(1200, 0.08);
      }
      setIsScanning(false);
    }, 1200);
  };

  const previewTotal = previewCart.reduce((s, l) => s + l.price * l.qty, 0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-extrabold text-gray-800 dark:text-zinc-100 mb-0.5">Test Scanner de Código de Barras</h3>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
          Simulá un scan con producto aleatorio para verificar que el lector HID funciona correctamente. Este carrito es de prueba y no registra ventas.
        </p>

        <button
          onClick={handleTestScan}
          disabled={isScanning || products.length === 0}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
            isScanning
              ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 animate-pulse border-amber-300'
              : 'bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 text-white border-transparent shadow-sm hover:opacity-90 active:scale-95'
          }`}
        >
          <ScanBarcode className="h-4 w-4" />
          {isScanning ? 'Escaneando...' : 'Test Scan (aleatorio)'}
        </button>

        {lastLog && (
          <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
            {lastLog}
          </p>
        )}
      </div>

      {/* Carrito de prueba */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-extrabold text-gray-600 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-amber-500" /> Carrito de prueba
          </h4>
          {previewCart.length > 0 && (
            <button
              onClick={() => { setPreviewCart([]); setLastLog(null); }}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-bold cursor-pointer"
            >
              <Trash2 className="h-3 w-3" /> Limpiar
            </button>
          )}
        </div>

        {previewCart.length === 0 ? (
          <div className="bg-gray-50 dark:bg-zinc-950 border border-dashed border-gray-200 dark:border-zinc-700 rounded-xl p-6 text-center text-gray-400 dark:text-zinc-500 text-xs">
            Sin ítems. Presioná "Test Scan" para simular una lectura.
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {previewCart.map((line, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-800 dark:text-zinc-100 truncate">{line.name}</p>
                    <p className="text-[10px] text-gray-400">{line.code} · {formatCurrency(line.price)} c/u</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="font-mono font-bold text-gray-600 dark:text-zinc-300">×{line.qty}</span>
                    <span className="font-bold text-amber-600">{formatCurrency(line.price * line.qty)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800">
              <span className="text-xs font-black text-gray-700 dark:text-zinc-200 uppercase tracking-wider">Total (prueba)</span>
              <span className="text-sm font-black text-amber-600 dark:text-amber-500">{formatCurrency(previewTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
