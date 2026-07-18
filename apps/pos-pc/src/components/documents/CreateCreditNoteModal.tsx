import { X, Loader2, Receipt, Search, Check } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { useApp } from '../../AppContext';
import type { CreditNoteResult } from '../../hooks/useDocuments';
import type { Sale } from '../../types';

// Sigue el patrón visual de components/transfers/CreateTransferModal.tsx.
//
// Buscador de venta original: reusa `sales` ya cargado en AppContext (el
// mismo dataset que consume SalesHistoryView) en vez de pegarle a un
// endpoint nuevo — filtra client-side por documentNumber/invoiceNumber o
// nombre de cliente. DT-7: sin venta seleccionada no se puede enviar.

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

export const CreateCreditNoteModal: React.FC<{
  onClose: () => void;
  onCreate: (payload: { sale_id: string; reason: string; amount: number }) => Promise<{ ok: boolean; data?: CreditNoteResult; error?: string }>;
  /** `originalDocumentNumber`: número de la venta referenciada, para imprimir la referencia (DT-7/DT-15). */
  onCreated: (result: CreditNoteResult, originalDocumentNumber: string | number) => void;
}> = ({ onClose, onCreate, onCreated }) => {
  const { sales = [] } = useApp();

  const [query, setQuery] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState<number>(0);
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

  const submit = async () => {
    setErr(null);
    if (!selectedSale) { setErr('Buscá y seleccioná la venta original'); return; }
    if (!reason.trim()) { setErr('Ingresá el motivo de la nota de crédito'); return; }
    if (!(amount > 0)) { setErr('El monto debe ser mayor a 0'); return; }

    setSubmitting(true);
    const result = await onCreate({
      sale_id: selectedSale.id,
      reason: reason.trim(),
      amount,
    });
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setErr(result.error ?? 'No se pudo crear la nota de crédito');
      return;
    }
    onCreated(result.data, selectedSale.documentNumber ?? selectedSale.invoiceNumber);
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

        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded p-1.5">
          Toda nota de crédito debe referenciar una venta real de esta sucursal.
        </p>

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
            <button
              onClick={() => setSelectedSale(null)}
              className="text-xs font-bold text-amber-600 hover:text-amber-700"
            >
              Cambiar
            </button>
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
          <button onClick={submit} disabled={submitting || !selectedSale}
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
