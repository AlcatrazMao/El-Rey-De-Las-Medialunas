import { Tag, Clock, AlertTriangle, X, Check, Plus } from 'lucide-react';
import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';

import { useSettings } from '../hooks/useSettings';
import { batchStore, offerStore, type IDBBatch, type IDBOffer } from '../lib/idb';
import { API_URL, fetchWithAuth } from '../services/api';

interface BatchInput {
  id: string;
  productId: string;
  productName?: string;
  batchNumber: string;
  expiryDate: string;
  stock: number;
  status: string;
}

interface Props {
  batches: BatchInput[];
}

type TabId = 'recommended' | 'history';

interface Toast {
  type: 'success' | 'error';
  message: string;
}

interface CreateForm {
  name: string;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
  notes: string;
}

function toLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimeRemaining(expiryDate: string): string {
  const target = new Date(expiryDate).getTime();
  if (Number.isNaN(target)) return '—';
  const diff = target - Date.now();
  if (diff <= 0) return 'Vencido';
  const hours = diff / (1000 * 60 * 60);
  if (hours >= 48) return 'Vence en 2+ días';
  if (hours >= 24) return 'Vence mañana';
  if (hours >= 12) return `Vence en ${Math.floor(hours)}h`;
  if (hours >= 1) return `Vence en ${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
  return 'Vence en menos de 1h';
}

function urgencyClasses(expiryDate: string): { border: string; badge: string } {
  const target = new Date(expiryDate).getTime();
  const diffH = (target - Date.now()) / (1000 * 60 * 60);
  if (diffH < 12) return { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' };
  if (diffH < 24) return { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400' };
  return { border: 'border-l-amber-400', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' };
}

function statusBadge(status: IDBOffer['status']): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400';
  if (status === 'cancelled') return 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400';
  return 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400';
}

function statusLabel(status: IDBOffer['status']): string {
  if (status === 'active') return 'Activa';
  if (status === 'cancelled') return 'Cancelada';
  return 'Expirada';
}

export const OffersView: React.FC<Props> = ({ batches }) => {
  const { settings } = useSettings();
  const branchId = settings.business.branchId;
  const offerRecommendHours = settings.inventory.offerRecommendHours;

  const [activeTab, setActiveTab] = useState<TabId>('recommended');
  const [recommended, setRecommended] = useState<BatchInput[]>([]);
  const [discountById, setDiscountById] = useState<Record<string, number>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({
    name: '',
    discountPercent: 20,
    startsAt: toLocalDateTime(new Date()),
    endsAt: '',
    notes: '',
  });
  const [history, setHistory] = useState<IDBOffer[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const loadRecommended = useCallback(async () => {
    let fromIdb: IDBBatch[] = [];
    try {
      fromIdb = await batchStore.getExpiring(offerRecommendHours);
    } catch {
      fromIdb = [];
    }
    if (fromIdb.length > 0) {
      const mapped: BatchInput[] = fromIdb.map(b => ({
        id: b.id,
        productId: b.productId,
        productName: b.productName,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate ?? '',
        stock: b.stock,
        status: b.status,
      }));
      setRecommended(mapped);
      return;
    }
    const limit = Date.now() + offerRecommendHours * 3600 * 1000;
    const fallback = batches.filter(b => {
      if (b.status !== 'active' || !b.expiryDate) return false;
      const t = new Date(b.expiryDate).getTime();
      return !Number.isNaN(t) && t <= limit;
    });
    setRecommended(fallback);
  }, [batches, offerRecommendHours]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/offers?branch_id=${encodeURIComponent(branchId)}&status=all`);
      if (!res.ok) throw new Error('fetch failed');
      const data = (await res.json()) as { offers?: IDBOffer[] } | IDBOffer[];
      const list = Array.isArray(data) ? data : (data.offers ?? []);
      setHistory(list);
    } catch {
      try {
        const local = await offerStore.getAll();
        setHistory(local);
      } catch {
        setHistory([]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [branchId]);

  useEffect(() => { loadRecommended(); }, [loadRecommended]);
  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab, loadHistory]);

  const handleOpenCreate = (batch: BatchInput) => {
    const discount = discountById[batch.id] ?? 20;
    const start = new Date();
    const end = batch.expiryDate ? new Date(batch.expiryDate) : new Date(Date.now() + 24 * 3600 * 1000);
    setCreateForm({
      name: `Oferta ${batch.productName ?? batch.productId} · Lote ${batch.batchNumber}`,
      discountPercent: discount,
      startsAt: toLocalDateTime(start),
      endsAt: toLocalDateTime(end),
      notes: '',
    });
    setCreatingFor(batch.id);
  };

  const handleConfirmCreate = async (batch: BatchInput) => {
    const offerId = `offer_${Date.now().toString(36)}`;
    const payload = {
      name: createForm.name.trim(),
      discount_percent: createForm.discountPercent,
      batch_ids: [batch.id],
      product_ids: [batch.productId],
      starts_at: new Date(createForm.startsAt).toISOString(),
      ends_at: createForm.endsAt ? new Date(createForm.endsAt).toISOString() : undefined,
      notes: createForm.notes || undefined,
      branch_id: branchId,
    };

    let synced = false;
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) synced = true;
    } catch {
      synced = false;
    }

    const localOffer: IDBOffer = {
      id: offerId,
      name: payload.name,
      discountPercent: payload.discount_percent,
      batchIds: payload.batch_ids,
      productIds: payload.product_ids,
      startsAt: payload.starts_at,
      endsAt: payload.ends_at,
      status: 'active',
      notes: payload.notes,
      createdAt: new Date().toISOString(),
      synced,
    };

    try {
      await offerStore.put(localOffer);
    } catch { /* IDB unavailable */ }

    setCreatingFor(null);
    showToast({
      type: synced ? 'success' : 'error',
      message: synced ? 'Oferta creada correctamente' : 'Guardada localmente — se sincronizará luego',
    });
  };

  const handleCancelOffer = async (offer: IDBOffer) => {
    let ok = false;
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/offers/${encodeURIComponent(offer.id)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }

    const updated: IDBOffer = { ...offer, status: 'cancelled', synced: ok };
    try { await offerStore.put(updated); } catch { /* noop */ }
    setHistory(prev => prev.map(o => o.id === offer.id ? updated : o));
    showToast({
      type: ok ? 'success' : 'error',
      message: ok ? 'Oferta cancelada' : 'Cancelación pendiente de sincronizar',
    });
  };

  return (
    <div className="space-y-6 transition-all duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <Tag className="h-5 w-5 text-amber-500" /> Gestión de Ofertas
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Crear y administrar ofertas de descuento para lotes próximos a vencer.
          </p>
        </div>

        {toast && (
          <div className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl self-start sm:self-auto animate-fade-in border ${
            toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
          }`}>
            {toast.type === 'success' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {toast.message}
          </div>
        )}
      </div>

      <div className="flex gap-1 flex-wrap">
        {([
          { id: 'recommended' as TabId, label: 'Recomendados' },
          { id: 'history' as TabId, label: 'Historial' },
        ]).map(t => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 bg-gray-100/60 dark:bg-zinc-800/40 hover:bg-gray-200/80 dark:hover:bg-zinc-800'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl p-5 md:p-6 shadow-xs min-h-[360px]">
        {activeTab === 'recommended' && (
          <div className="space-y-4">
            {recommended.length === 0 ? (
              <div className="text-center py-14 text-gray-400 text-xs font-semibold border border-dashed border-gray-200 dark:border-zinc-700 rounded-2xl">
                No hay artículos próximos a vencer en las próximas {offerRecommendHours} horas.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {recommended.map(batch => {
                  const u = urgencyClasses(batch.expiryDate);
                  const isCreating = creatingFor === batch.id;
                  return (
                    <div
                      key={batch.id}
                      className={`bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 border-l-4 ${u.border} rounded-2xl p-4 space-y-3 transition-all`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-gray-800 dark:text-zinc-100 truncate">
                            {batch.productName ?? batch.productId}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">Lote {batch.batchNumber} · Stock {batch.stock}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${u.badge}`}>
                          <Clock className="h-3 w-3 inline mr-1" />
                          {formatTimeRemaining(batch.expiryDate)}
                        </span>
                      </div>

                      {!isCreating ? (
                        <div className="flex items-end gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                              Descuento sugerido
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                min="1"
                                max="100"
                                step="1"
                                value={discountById[batch.id] ?? 20}
                                onChange={e => setDiscountById(d => ({ ...d, [batch.id]: Number(e.target.value) }))}
                                className="w-full text-xs font-semibold bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 pr-7 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                              />
                              <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-bold">%</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenCreate(batch)}
                            className="flex items-center gap-1.5 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" /> Crear oferta
                          </button>
                        </div>
                      ) : (
                        <div className="border border-amber-200 dark:border-amber-800 bg-amber-50/20 dark:bg-amber-950/10 rounded-xl p-3 space-y-3">
                          <p className="text-[10px] font-extrabold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Confirmar oferta</p>

                          <div className="space-y-1">
                            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Nombre</label>
                            <input
                              type="text"
                              value={createForm.name}
                              onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                              maxLength={80}
                              className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Inicio</label>
                              <input
                                type="datetime-local"
                                value={createForm.startsAt}
                                onChange={e => setCreateForm(f => ({ ...f, startsAt: e.target.value }))}
                                className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Fin</label>
                              <input
                                type="datetime-local"
                                value={createForm.endsAt}
                                onChange={e => setCreateForm(f => ({ ...f, endsAt: e.target.value }))}
                                className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Descuento</label>
                              <div className="relative">
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  step="1"
                                  value={createForm.discountPercent}
                                  onChange={e => setCreateForm(f => ({ ...f, discountPercent: Number(e.target.value) }))}
                                  className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 pr-7 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                                />
                                <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-bold">%</span>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">Notas</label>
                              <input
                                type="text"
                                value={createForm.notes}
                                onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="Opcional"
                                className="w-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-850 dark:text-zinc-100"
                              />
                            </div>
                          </div>

                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmCreate(batch)}
                              disabled={!createForm.name.trim()}
                              className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setCreatingFor(null)}
                              className="px-3 py-2 text-xs font-bold ring-1 ring-gray-200 dark:ring-zinc-700 text-gray-500 dark:text-zinc-400 hover:text-gray-700 rounded-xl cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-3">
            {historyLoading ? (
              <div className="text-center py-14 text-gray-400 text-xs font-semibold">Cargando ofertas...</div>
            ) : history.length === 0 ? (
              <div className="text-center py-14 text-gray-400 text-xs font-semibold border border-dashed border-gray-200 dark:border-zinc-700 rounded-2xl">
                No hay ofertas registradas.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-zinc-800">
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">Descuento</th>
                      <th className="py-2 pr-3">Productos</th>
                      <th className="py-2 pr-3">Inicio</th>
                      <th className="py-2 pr-3">Fin</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(o => (
                      <tr key={o.id} className="border-b border-gray-50 dark:border-zinc-800/60 text-xs font-semibold text-gray-700 dark:text-zinc-200">
                        <td className="py-3 pr-3">{o.name}</td>
                        <td className="py-3 pr-3">{o.discountPercent}%</td>
                        <td className="py-3 pr-3">{o.productIds.length}</td>
                        <td className="py-3 pr-3">{new Date(o.startsAt).toLocaleDateString()}</td>
                        <td className="py-3 pr-3">{o.endsAt ? new Date(o.endsAt).toLocaleDateString() : '—'}</td>
                        <td className="py-3 pr-3">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusBadge(o.status)}`}>
                            {statusLabel(o.status)}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right">
                          {o.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleCancelOffer(o)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg cursor-pointer transition-all"
                            >
                              <X className="h-3 w-3" /> Cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
