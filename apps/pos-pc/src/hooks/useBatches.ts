import { useState, useEffect } from 'react';
import { INITIAL_PRODUCTS } from '../initialData';
import { safeSetItem } from '../utils/safeStorage';
import type { ProductBatch, BatchWithdrawalRequest, Product } from '../types';

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
        initialBatches.push({
          id: `batch_${prod.id}_expired_${index}`,
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-E-${String(index + 30).padStart(2, '0')}`,
          quantity: expiredQty,
          stock: expiredQty,
          elaborationDate: expElab.toISOString().split('T')[0],
          expiryDate: new Date(expElab.getTime() + durability * 86400000).toISOString().split('T')[0],
          status: 'active',
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
    return [
      {
        id: 'req_1',
        batchId: 'batch_prod_pan_flauta_expired_0',
        productId: 'prod_pan_flauta',
        productName: 'Pan Flauta (Baguette)',
        batchNumber: 'L-PAN-E-10',
        quantity: 12,
        reason: 'Lote caducó hace 2 días, retirar rancio de góndola',
        requestedBy: 'Damián (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'req_2',
        batchId: 'batch_prod_facturas_surtidas_expired_2',
        productId: 'prod_facturas_surtidas',
        productName: 'Facturas Surtidas',
        batchNumber: 'L-FAC-E-12',
        quantity: 5,
        reason: 'Medialunas secas no aptas para venta',
        requestedBy: 'Sofía (Cajero/a)',
        status: 'approved',
        date: new Date(Date.now() - 14400000).toISOString(),
        adminMemo: 'Confirmado retiro, de baja mermas.',
      },
    ];
  });

  useEffect(() => {
    safeSetItem('pan_erp_batches', JSON.stringify(batches));
  }, [batches]);

  useEffect(() => {
    safeSetItem('pan_erp_withdrawal_requests', JSON.stringify(withdrawalRequests));
  }, [withdrawalRequests]);

  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTime = new Date(todayStr + 'T00:00:00').getTime();

    const expiredAutoBatches = batches.filter(
      (b) =>
        b.withdrawalMode === 'automatic' &&
        b.status === 'active' &&
        b.stock > 0 &&
        new Date(b.expiryDate + 'T00:00:00').getTime() < todayTime,
    );

    if (expiredAutoBatches.length > 0) {
      let addedAny = false;
      setWithdrawalRequests((prev) => {
        const updated = [...prev];
        expiredAutoBatches.forEach((b) => {
          const exists = updated.some((r) => r.batchId === b.id && r.status === 'pending');
          if (!exists) {
            const prodObj = products.find((p) => p.id === b.productId);
            updated.unshift({
              id: `req_auto_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
              batchId: b.id,
              productId: b.productId,
              productName: prodObj ? prodObj.name : 'Bakery Item',
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
              `El lote ${b.batchNumber} de "${prodObj?.name || 'Pan'}" ha expirado. Solicitud enviada a administración.`,
              'warning',
            );
          }
        });
        return addedAny ? updated : prev;
      });
    }
  }, [batches, products]);

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
