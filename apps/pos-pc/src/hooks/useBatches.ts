import { useState, useEffect, useRef, useCallback } from 'react';

import { INITIAL_PRODUCTS } from '../initialData';
import { API_URL, fetchWithAuth } from '../services/api';
import { enqueue, isNetworkError } from '../services/d1-sync';
import type { ProductBatch, Product } from '../types';
import { safeSetItem } from '../utils/safeStorage';

import { getSettings } from './useSettings';

/** UUID sin guiones, compatible con todos los entornos modernos (HTTPS o localhost). */
const uid = () => crypto.randomUUID().replace(/-/g, '');

/**
 * Versión local conocida de los lotes. Mismo criterio que VERSION_KEY en
 * useRequests: guardamos la última versión que trajimos de D1 para decidir en
 * cada poll si hace falta refetch completo o alcanza con el cache local.
 */
const BATCHES_VERSION_KEY = 'pan_erp_batches_version';

/** Forma cruda que devuelve GET /api/v2/batches (snake_case, ids de servidor). */
interface BatchRow {
  id: string;
  product_id: string;
  batch_number: string;
  entry_date: string;
  expiry_date: string | null;
  initial_quantity: number;
  remaining_quantity: number;
  status: string;
}

const VALID_BATCH_STATUSES = new Set(['active', 'withdrawn', 'sold_out', 'expired']);

// El backend no persiste withdrawalMode (manual/automatic); mapeamos a 'manual'
// porque la expiración automática la resuelve el cron server-side (/expire-stale).
function mapBatchRow(row: BatchRow): ProductBatch {
  const status = VALID_BATCH_STATUSES.has(row.status) ? (row.status as ProductBatch['status']) : 'active';
  return {
    id: row.id,
    productId: row.product_id,
    batchNumber: row.batch_number,
    quantity: Number(row.initial_quantity ?? 0),
    stock: Number(row.remaining_quantity ?? 0),
    elaborationDate: row.entry_date,
    expiryDate: row.expiry_date ?? '',
    status,
    withdrawalMode: 'manual',
  };
}

function readInitialBatchVersion(): number {
  try {
    return Number(localStorage.getItem(BATCHES_VERSION_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

/**
 * Set persistido de ids de lotes para los que YA generamos una solicitud de
 * merma automática por vencimiento. Evita que el chequeo horario (o un reload)
 * dispare una solicitud duplicada mientras el lote sigue `active` esperando
 * aprobación. Se limpia junto con el resto de `pan_erp_*` en resetAllData.
 */
const AUTO_EXPIRY_KEY = 'pan_erp_auto_expiry_requested';

function loadAutoExpiryRequested(): Set<string> {
  try {
    const saved = localStorage.getItem(AUTO_EXPIRY_KEY);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {
    localStorage.removeItem(AUTO_EXPIRY_KEY);
  }
  return new Set();
}

type NotifyFn = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
) => void;

interface UseBatchesParams {
  notify: NotifyFn;
  products: Product[];
}

/**
 * Construye y envía una solicitud de merma (`type:'waste'`) al backend real de
 * Solicitudes (POST /api/v2/requests). El backend decide el status según el rol
 * del creador: admin/owner → nace `completed`; cualquier otro → `pending_approval`.
 * El descuento de stock NO se aplica acá: lo aplica AppContext cuando la request
 * pasa a `completed` (source of truth = useRequests).
 */
function postWasteRequest(args: {
  title: string;
  description: string;
  batchId: string;   // id LOCAL del ProductBatch (client_batch_id)
  productId: string;
  quantity: number;
  reason: string;
}): Promise<Response> {
  const branchId = getSettings().business.branchId;
  const payload = {
    type: 'waste',
    title: args.title,
    description: args.description,
    assigned_role: 'admin',
    branch_id: branchId,
    metadata: {
      batch_id: args.batchId,
      product_id: args.productId,
      quantity: args.quantity,
      reason: args.reason,
    },
  };
  return fetchWithAuth(`${API_URL}/api/v2/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function useBatches({ notify, products }: UseBatchesParams) {
  const [batches, setBatches] = useState<ProductBatch[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_batches');
      if (saved) return JSON.parse(saved) as ProductBatch[];
    } catch (e) {
      console.error('Error parsing batches from localStorage:', e);
      localStorage.removeItem('pan_erp_batches');
    }

    const initialBatches: ProductBatch[] = [];
    INITIAL_PRODUCTS.forEach((prod, index) => {
      const durability = prod.durabilityDays || 3;
      const totalStock = prod.stock || 50;
      const freshQty = Math.floor(totalStock * 0.6);
      const nearQty = Math.floor(totalStock * 0.3);
      const expiredQty = totalStock - freshQty - nearQty;

      if (freshQty > 0) {
        const freshElab = new Date();
        initialBatches.push({
          id: uid(),
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-F-${String(index + 10).padStart(2, '0')}`,
          quantity: freshQty,
          stock: freshQty,
          elaborationDate: freshElab.toISOString().split('T')[0],
          expiryDate: new Date(freshElab.getTime() + durability * 86400000).toISOString().split('T')[0],
          status: 'active',
          withdrawalMode: 'manual',
        });
      }
      if (nearQty > 0) {
        const nearElab = new Date();
        nearElab.setDate(nearElab.getDate() - (durability - 1));
        initialBatches.push({
          id: uid(),
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-N-${String(index + 20).padStart(2, '0')}`,
          quantity: nearQty,
          stock: nearQty,
          elaborationDate: nearElab.toISOString().split('T')[0],
          expiryDate: new Date(nearElab.getTime() + durability * 86400000).toISOString().split('T')[0],
          status: 'active',
          withdrawalMode: 'manual',
        });
      }
      if (expiredQty > 0) {
        const expElab = new Date();
        expElab.setDate(expElab.getDate() - (durability + 1));
        const expExpiryDate = new Date(expElab.getTime() + durability * 86400000).toISOString().split('T')[0];
        const isExpired = new Date(expExpiryDate).getTime() < Date.now();
        initialBatches.push({
          id: uid(),
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-E-${String(index + 30).padStart(2, '0')}`,
          quantity: expiredQty,
          stock: expiredQty,
          elaborationDate: expElab.toISOString().split('T')[0],
          expiryDate: expExpiryDate,
          status: isExpired ? 'expired' : 'active',
          withdrawalMode: 'manual',
        });
      }
    });
    return initialBatches;
  });

  // Refs para que checkExpiry lea SIEMPRE el último valor de products/batches
  // sin capturarlos en la clausura del effect (evita stale closures).
  const productsRef = useRef(products);
  useEffect(() => { productsRef.current = products; }, [products]);
  const batchesRef = useRef(batches);
  useEffect(() => { batchesRef.current = batches; }, [batches]);

  // Idempotencia de las solicitudes de merma automática: una vez que POSTeamos
  // la request de un lote vencido, guardamos su id acá (persistido) para no
  // volver a generarla en el próximo tick horario ni tras un reload, mientras
  // el lote sigue `active` esperando aprobación.
  const autoExpiryRequestedRef = useRef<Set<string>>(loadAutoExpiryRequested());
  const persistAutoExpiry = () => {
    safeSetItem(AUTO_EXPIRY_KEY, JSON.stringify([...autoExpiryRequestedRef.current]));
  };

  useEffect(() => {
    safeSetItem('pan_erp_batches', JSON.stringify(batches));
  }, [batches]);

  // ── Sincronización con D1 (mismo patrón version-check que useRequests) ──────
  // Guardamos la última versión conocida en localStorage; cada poll compara
  // contra GET /batches/version y solo hace el refetch completo si difiere.
  const lastBatchVersionRef = useRef<number>(readInitialBatchVersion());
  const batchSyncInFlightRef = useRef(false);

  /**
   * Refetch completo de los lotes de la sucursal desde D1 y reemplazo del cache
   * (estado + localStorage vía el effect de persistencia). Sin red cae gentil al
   * cache local existente sin romper el flujo de venta. Exportada para poder
   * refrescar el stock del LOTE de forma inmediata tras completarse una merma.
   */
  const refreshBatchesFromD1 = useCallback(async (): Promise<void> => {
    if (batchSyncInFlightRef.current) return;
    batchSyncInFlightRef.current = true;
    try {
      const branchId = getSettings().business.branchId;
      const res = await fetchWithAuth(
        `${API_URL}/api/v2/batches/?status=all&branch_id=${encodeURIComponent(branchId)}`,
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { success: boolean; data: BatchRow[] };
      if (body.success && Array.isArray(body.data)) {
        setBatches(body.data.map(mapBatchRow));
      }
    } catch {
      // Sin red / error de servidor: conservamos el cache local ya cargado.
    } finally {
      batchSyncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const checkAndSync = async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/v2/batches/version`);
        if (!res.ok) throw new Error(`version ${res.status}`);
        const body = (await res.json()) as { success: boolean; data: { version: number } };
        const remote = body?.data?.version ?? 0;
        if (remote !== lastBatchVersionRef.current) {
          await refreshBatchesFromD1();
          lastBatchVersionRef.current = remote;
          try { localStorage.setItem(BATCHES_VERSION_KEY, String(remote)); } catch { /* quota */ }
        }
      } catch {
        // Sin red: seguimos con el cache local, sin romper nada.
      }
    };
    void checkAndSync();
    const id = setInterval(() => { void checkAndSync(); }, 60_000);
    return () => clearInterval(id);
  }, [refreshBatchesFromD1]);

  useEffect(() => {
    // checkExpiry es un puro side-effect: NO muta el estado del lote (ya no lo
    // marcamos `expired` en el acto — ése era el bug de auto-expiración). En su
    // lugar genera una solicitud de merma `waste`. El lote sigue `active` hasta
    // que la request pase a `completed` y AppContext aplique el descuento.
    const checkExpiry = () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayTime = new Date(todayStr + 'T00:00:00').getTime();

      const expiredAuto = batchesRef.current.filter(
        (b) =>
          b.withdrawalMode === 'automatic' &&
          b.status === 'active' &&
          b.stock > 0 &&
          new Date(b.expiryDate + 'T00:00:00').getTime() < todayTime &&
          !autoExpiryRequestedRef.current.has(b.id),
      );

      if (expiredAuto.length === 0) return;

      // Reservar + persistir los ids ANTES de disparar los POST para que un tick
      // concurrente / un reload no vuelva a generar la misma solicitud.
      expiredAuto.forEach((b) => autoExpiryRequestedRef.current.add(b.id));
      persistAutoExpiry();

      expiredAuto.forEach((b) => {
        const productName =
          productsRef.current.find((p) => p.id === b.productId)?.name ?? 'Producto';
        postWasteRequest({
          title: `Merma automática por vencimiento: ${productName}`,
          description: 'Baja automática generada por fecha límite de caducidad.',
          batchId: b.id,
          productId: b.productId,
          quantity: b.stock,
          reason: 'Baja automática generada por fecha límite de caducidad.',
        })
          .then((res) => {
            if (!res.ok) throw new Error(`status ${res.status}`);
          })
          .catch(() => {
            // Falló el POST: liberamos el id para reintentar en el próximo tick.
            autoExpiryRequestedRef.current.delete(b.id);
            persistAutoExpiry();
          });
        notify(
          '⏳ Lote Vencido (Automático)',
          `El lote ${b.batchNumber} venció. Se generó una solicitud de merma para aprobación de administración.`,
          'warning',
        );
      });
    };

    checkExpiry(); // check al montar
    const interval = setInterval(checkExpiry, 3_600_000); // cada hora
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `notify` es estable (useRef en useNotifications); products/batches se leen via refs para evitar stale closures
  }, []);

  /**
   * Solicitud de merma MANUAL disparada por un operador (cajero/panadero/admin).
   * POSTea a la API real de Solicitudes. El backend decide el status según el
   * rol: admin/owner → `completed` (auto-aprobada); resto → `pending_approval`.
   *
   * Tolerancia offline: si el POST falla por error de RED, encolamos la merma en
   * la cola de sync (`enqueue`, mismo patrón que supply_request) y devolvemos
   * `{ queued: true }` para que el caller muestre un estado intermedio en vez de
   * error. Si el fallo NO es de red (validación 4xx/servidor), re-lanzamos el
   * error real — la merma no se encola ni se da por registrada.
   */
  const requestBatchWithdrawal = async (
    batchId: string,
    quantity: number,
    reason: string,
  ): Promise<{ queued: boolean }> => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) throw new Error('El lote seleccionado ya no existe.');
    const prod = products.find((p) => p.id === batch.productId);
    const productName = prod?.name ?? 'Artículo';

    // El id client-side permite que la merma encolada conserve identidad estable
    // al drenar la cola (el backend lo usa como request id si vino offline).
    const payload = {
      id: uid(),
      type: 'waste',
      title: `Merma: ${productName} ×${quantity}`,
      description: reason,
      assigned_role: 'admin',
      branch_id: getSettings().business.branchId,
      metadata: {
        batch_id: batch.id,
        product_id: batch.productId,
        quantity,
        reason,
      },
    };

    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = 'No se pudo registrar la solicitud de merma. Reintentá.';
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data?.error?.message) msg = data.error.message;
        } catch { /* body no-JSON */ }
        throw new Error(msg);
      }
      return { queued: false };
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueue('waste_request', payload);
        return { queued: true };
      }
      throw err;
    }
  };

  return {
    batches,
    setBatches,
    requestBatchWithdrawal,
    refreshBatchesFromD1,
  };
}
