import { useState, useEffect, useRef } from 'react';

import { INITIAL_PRODUCTS } from '../initialData';
import type { ProductBatch, BatchWithdrawalRequest, Product } from '../types';
import { safeSetItem } from '../utils/safeStorage';

type NotifyFn = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
) => void;

interface UseBatchesParams {
  notify: NotifyFn;
  products: Product[];
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
          id: `batch_${prod.id}_fresh_${index}`,
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
          id: `batch_${prod.id}_near_${index}`,
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
          id: `batch_${prod.id}_expired_${index}`,
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

  const [withdrawalRequests, setWithdrawalRequests] = useState<BatchWithdrawalRequest[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_withdrawal_requests');
      if (saved) return JSON.parse(saved) as BatchWithdrawalRequest[];
    } catch (e) {
      localStorage.removeItem('pan_erp_withdrawal_requests');
    }
    return [];
  });

  // Bug 2 fix: keep a ref to products so checkExpiry can read the latest value
  // without capturing it in the effect's closure.
  const productsRef = useRef(products);
  useEffect(() => { productsRef.current = products; }, [products]);

  // Bug fix race-condition: si checkExpiry corre dos veces en paralelo (mount
  // + interval que coincide), dos updaters de setBatches/setWithdrawalRequests
  // podrían procesar el mismo batch generando una solicitud duplicada en el
  // window entre el primer scheduling y el commit del setter. Trackear los
  // batchIds "en vuelo" garantiza idempotencia por id durante el procesamiento.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    safeSetItem('pan_erp_batches', JSON.stringify(batches));
  }, [batches]);

  useEffect(() => {
    safeSetItem('pan_erp_withdrawal_requests', JSON.stringify(withdrawalRequests));
  }, [withdrawalRequests]);

  useEffect(() => {
    const checkExpiry = () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayTime = new Date(todayStr + 'T00:00:00').getTime();

      // Bug 1 fix: flat setters — no nested setState calls.
      // Step 1: compute which batches expired and build the new requests array,
      // then apply both setters sequentially (never nested).
      setBatches((prevBatches) => {
        // Bug C fix: derive expiredAutoBatches inside the updater so it always
        // uses the latest state and never closes over a stale snapshot.
        // Race fix: filtramos los batchIds que ya están siendo procesados por
        // otra llamada en vuelo para no duplicar requests / commits.
        const expiredAutoBatches = prevBatches.filter(
          (b) =>
            b.withdrawalMode === 'automatic' &&
            b.status === 'active' &&
            b.stock > 0 &&
            new Date(b.expiryDate + 'T00:00:00').getTime() < todayTime &&
            !inFlightRef.current.has(b.id),
        );

        if (expiredAutoBatches.length === 0) return prevBatches;

        // Reservar los ids antes de schedulear el siguiente setter para que una
        // llamada concurrente los vea como "in flight" y los saltee.
        expiredAutoBatches.forEach((b) => inFlightRef.current.add(b.id));

        // Schedule the withdrawal-requests update in the next microtask so it
        // runs after this setter has committed — standard trick to break nesting.
        setTimeout(() => {
          setWithdrawalRequests((prevRequests) => {
            const updated = [...prevRequests];
            let addedAny = false;
            expiredAutoBatches.forEach((b) => {
              const exists = updated.some((r) => r.batchId === b.id && r.status === 'pending');
              if (!exists) {
                const productName =
                  productsRef.current.find((p) => p.id === b.productId)?.name ?? 'Producto';
                updated.unshift({
                  id: `req_auto_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
                  batchId: b.id,
                  productId: b.productId,
                  productName,
                  batchNumber: b.batchNumber,
                  quantity: b.stock,
                  reason: 'Baja automática generada por fecha límite de caducidad.',
                  requestedBy: 'Chequeo Automatizado ERP',
                  status: 'pending',
                  date: new Date().toISOString(),
                });
                addedAny = true;
                notify(
                  '⏳ Lote Expirado (Automático)',
                  `El lote ${b.batchNumber} ha expirado. Solicitud enviada a administración.`,
                  'warning',
                );
              }
            });
            // Liberar los ids procesados — la transición ya está commiteada en
            // ambos setters cuando este updater retorna.
            expiredAutoBatches.forEach((b) => inFlightRef.current.delete(b.id));
            return addedAny ? updated : prevRequests;
          });
        }, 0);

        // Bug A fix: return updated batches with expired ones marked as 'expired'
        // instead of returning prevBatches unchanged.
        return prevBatches.map((b) =>
          expiredAutoBatches.some((e) => e.id === b.id) ? { ...b, status: 'expired' } : b,
        );
      });
    };

    checkExpiry(); // check al montar
    const interval = setInterval(checkExpiry, 3_600_000); // cada hora
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `notify` no cambia de identidad entre renders (viene de un useRef estable en useNotifications), y accedemos a batches/withdrawalRequests via setters funcionales para evitar stale closures
  }, []);

  const requestBatchWithdrawal = (
    batchId: string,
    quantity: number,
    reason: string,
    requestedByName: string,
    requestedByRole: string,
  ): void => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const prod = products.find((p) => p.id === batch.productId);
    const roleLabel =
      requestedByRole === 'admin'
        ? 'Administrador'
        : requestedByRole === 'cajero'
        ? 'Caja'
        : 'Panadero';
    const request: BatchWithdrawalRequest = {
      id: `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
      batchId,
      productId: batch.productId,
      productName: prod?.name ?? 'Artículo',
      batchNumber: batch.batchNumber,
      quantity,
      reason,
      requestedBy: `${requestedByName} (${roleLabel})`,
      status: 'pending',
      date: new Date().toISOString(),
    };
    setWithdrawalRequests((prev) => [request, ...prev]);
    // TODO(Bug B): sync withdrawal request to D1. No dedicated sync function exists
    // in d1-sync.ts yet. Add `syncWithdrawalRequestToD1` there and call it here
    // once implemented, similar to how useSupplyRequests calls syncSupplyRequestToD1.
    notify(
      '🔔 Solicitud de Baja Registrada',
      `Se solicitó retirar ${quantity} u. del lote ${batch.batchNumber} de "${request.productName}".`,
      'info',
    );
  };

  const rejectWithdrawalRequest = (requestId: string, adminMemo: string): void => {
    setWithdrawalRequests((prev) =>
      prev.map((r) => {
        if (r.id !== requestId || r.status !== 'pending') return r;
        const req: BatchWithdrawalRequest = { ...r, status: 'rejected', adminMemo };
        notify(
          '❌ Solicitud de Baja Rechazada',
          `Se rechazó dar de baja el lote ${req.batchNumber} de "${req.productName}". Detalle: ${adminMemo}`,
          'error',
        );
        return req;
      }),
    );
  };

  return {
    batches,
    setBatches,
    withdrawalRequests,
    setWithdrawalRequests,
    requestBatchWithdrawal,
    rejectWithdrawalRequest,
  };
}
