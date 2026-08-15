import { X, Loader2, Receipt, Search, Check, Plus, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { useApp } from '../../AppContext';
import type { CreateCreditNotePayload, CreditNoteResult } from '../../hooks/useDocuments';
import type { Sale } from '../../types';
import type { DocumentPrintItem } from '../../utils/exportUtils';

// Sigue el patrón visual de components/transfers/CreateTransferModal.tsx.
//
// Dos modos:
//   A) Referenciar venta (DT-7 original): buscá la venta y ajustá su monto.
//   B) Devolución standalone (fallback desde carrito): sin venta referenciada;
//      devuelve mercadería al stock y descuenta el monto de la caja abierta.

function saleLabel(sale: Sale): string {
  const num = sale.documentNumber ?? sale.invoiceNumber;
  return `#${num}`;
}

function saleMatchesQuery(sale: Sale, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    String(sale.documentNumber ?? '').toLowerCase().includes(q) ||
    sale.invoiceNumber.toLowerCase().includes(q) ||
    (sale.customerName ?? '').toLowerCase().includes(q)
  );
}

interface ReturnLineDraft {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export const CreateCreditNoteModal: React.FC<{
  onClose: () => void;
  onCreate: (payload: CreateCreditNotePayload) => Promise<{ ok: boolean; data?: CreditNoteResult; error?: string }>;
  /** `originalDocumentNumber`: número de la venta referenciada (modo A) o null (modo B). `printItems`: líneas de la devolución (modo B). */
  onCreated: (result: CreditNoteResult, originalDocumentNumber: string | number | null, printItems?: DocumentPrintItem[]) => void;
}> = ({ onClose, onCreate, onCreated }) => {
  const { sales = [], products = [], currentCashSession } = useApp();

  const [mode, setMode] = useState<'sale' | 'return'>('sale');

  // ── Modo A: referenciar venta ──
  const [query, setQuery] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [amount, setAmount] = useState<number>(0);

  // ── Modo B: devolución ──
  const [items, setItems] = useState<ReturnLineDraft[]>([
    { product_id: products[0]?.id ?? '', quantity: 1, unit_price: products[0]?.price ?? 0 },
  ]);

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Ventas más recientes primero; limitamos a 20 resultados para no listar
  // el historial completo en el picker.
  const results = useMemo(() => {
    return [...sales]
      .filter(s => s.paymentStatus !== 'voided' && saleMatchesQuery(s, query))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 20);
  }, [sales, query]);

  const selectSale = (sale: Sale) => {
    setSelectedSale(sale);
    setAmount(sale.total);
  };

  const addItem = () => setItems(prev => [...prev, { product_id: products[0]?.id ?? '', quantity: 1, unit_price: products[0]?.price ?? 0 }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<ReturnLineDraft>) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const selectProduct = (idx: number, productId: string) => {
    const product = products.find(p => p.id === productId);
    updateItem(idx, { product_id: productId, unit_price: product?.price ?? 0 });
  };

  const returnTotal = useMemo(
    () => items.reduce((acc, it) => acc + (it.quantity > 0 ? it.quantity * it.unit_price : 0), 0),
    [items],
  );

  const hasOpenCashSession = !!currentCashSession && currentCashSession.status === 'open';

  const submit = async () => {
    setErr(null);
    if (!reason.trim()) { setErr('Ingresá el motivo de la nota de crédito'); return; }

    if (mode === 'sale') {
      if (!selectedSale) { setErr('Buscá y seleccioná la venta original'); return; }
      if (!(amount > 0)) { setErr('El monto debe ser mayor a 0'); return; }
    } else {
      if (!hasOpenCashSession) { setErr('No hay caja abierta: no se puede descontar la devolución de la caja'); return; }
      const validItems = items.filter(it => it.product_id && it.quantity > 0 && it.unit_price >= 0);
      if (validItems.length === 0) { setErr('Agregá al menos un producto con cantidad válida'); return; }
    }

    setSubmitting(true);
    const payload: CreateCreditNotePayload = mode === 'sale'
      ? { sale_id: selectedSale!.id, reason: reason.trim(), amount }
      : {
          reason: reason.trim(),
          cash_session_id: currentCashSession!.id,
          items: items
            .filter(it => it.product_id && it.quantity > 0)
            .map(it => ({ product_id: it.product_id, quantity: it.quantity, unit_price: it.unit_price })),
        };
    const result = await onCreate(payload);
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setErr(result.error ?? 'No se pudo crear la nota de crédito');
      return;
    }

    if (mode === 'sale') {
      onCreated(result.data, selectedSale!.documentNumber ?? selectedSale!.invoiceNumber);
    } else {
      const printItems: DocumentPrintItem[] = items
        .filter(it => it.product_id && it.quantity > 0)
        .map(it => ({
          name: products.find(p => p.id === it.product_id)?.name || it.product_id,
          quantity: it.quantity,
          price: it.unit_price,
        }));
      onCreated(result.data, null, printItems);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Receipt className="h-4 w-4 text-amber-500" /> Nueva nota de crédito
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5">
          <button
            onClick={() => setMode('sale')}
            className={`flex-1 px-2 py-1.5 text-xs font-bold rounded-md cursor-pointer transition-colors ${mode === 'sale' ? 'bg-white dark:bg-zinc-900 text-amber-600 shadow-sm' : 'text-gray-500 dark:text-zinc-400'}`}
          >
            Referenciar venta
          </button>
          <button
            onClick={() => setMode('return')}
            className={`flex-1 px-2 py-1.5 text-xs font-bold rounded-md cursor-pointer transition-colors ${mode === 'return' ? 'bg-white dark:bg-zinc-900 text-amber-600 shadow-sm' : 'text-gray-500 dark:text-zinc-400'}`}
          >
            Devolución (sin venta)
          </button>
        </div>

        {mode === 'sale' ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
            Toda nota de crédito debe referenciar una venta real de esta sucursal.
          </p>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
            La devolución devuelve mercadería al stock y descuenta el total de la caja abierta.
          </p>
        )}

        {mode === 'sale' ? (
          <>
            {!selectedSale ? (
              <>
                <label className="block relative">
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Buscar venta original</span>
                  <div className="relative mt-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                      type="text"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Nro de comprobante o nombre del cliente…"
                      className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                    />
                  </div>
                </label>

                <div className="border border-gray-100 dark:border-zinc-800 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800">
                  {results.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Sin resultados</div>
                  ) : (
                    results.map(sale => (
                      <button
                        key={sale.id}
                        onClick={() => selectSale(sale)}
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition-colors"
                      >
                        <div>
                          <div className="text-xs font-bold text-gray-800 dark:text-zinc-200">{saleLabel(sale)} · {sale.customerName || 'Consumidor Final'}</div>
                          <div className="text-[10px] text-gray-400">{new Date(sale.date).toLocaleString('es-AR')}</div>
                        </div>
                        <span className="text-xs font-bold text-amber-600">${sale.total.toFixed(2)}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600" />
                  <div>
                    <div className="text-xs font-bold text-gray-800 dark:text-zinc-200">{saleLabel(selectedSale)} · {selectedSale.customerName || 'Consumidor Final'}</div>
                    <div className="text-[10px] text-gray-400">Total original: ${selectedSale.total.toFixed(2)}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedSale(null)} className="text-xs font-bold text-amber-600 hover:text-amber-700">
                  Cambiar
                </button>
              </div>
            )}

            <label className="block">
              <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Monto</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
              />
            </label>
          </>
        ) : (
          <div className="space-y-2">
            {!hasOpenCashSession && (
              <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded p-1.5">
                No hay caja abierta. Abrí el turno de caja para poder emitir una devolución.
              </div>
            )}
            <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Productos a devolver</span>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={item.product_id}
                  onChange={e => selectProduct(idx, e.target.value)}
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                >
                  <option value="" disabled>Seleccionar artículo…</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.image} {p.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={e => updateItem(idx, { quantity: Number(e.target.value) })}
                  className="w-16 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                  title="Cantidad"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_price}
                  onChange={e => updateItem(idx, { unit_price: Number(e.target.value) })}
                  className="w-24 px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100"
                  title="Precio unitario"
                />
                <button
                  onClick={() => removeItem(idx)}
                  disabled={items.length <= 1}
                  className="text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button onClick={addItem} className="text-xs font-bold text-amber-600 hover:text-amber-700 inline-flex items-center gap-1">
              <Plus className="h-3 w-3" /> Agregar producto
            </button>
            <div className="flex items-center justify-between px-1 py-2 border-t border-gray-100 dark:border-zinc-800">
              <span className="text-sm font-bold text-gray-700 dark:text-zinc-300">Total a devolver</span>
              <span className="text-lg font-black text-amber-600">${returnTotal.toFixed(2)}</span>
            </div>
          </div>
        )}

        <label className="block">
          <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Motivo</span>
          <textarea
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            placeholder="Ej: devolución parcial de mercadería…"
          />
        </label>

        {err && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded px-2 py-1">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={submitting}
            className="flex-1 px-3 py-2 text-xs font-bold text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={submitting || (mode === 'sale' && !selectedSale) || (mode === 'return' && !hasOpenCashSession)}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Crear nota de crédito
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateCreditNoteModal;
