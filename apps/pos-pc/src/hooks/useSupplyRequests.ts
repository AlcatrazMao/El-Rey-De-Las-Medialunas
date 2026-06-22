import { useState, useEffect } from 'react';

import { syncSupplyRequestToD1, updateSupplyRequestStatusInD1 } from '../services/d1-sync';
import type { SupplyRequest, Ingredient, Product } from '../types';
import { safeSetItem } from '../utils/safeStorage';

type NotifyFn = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
) => void;

interface UseSupplyRequestsParams {
  notify: NotifyFn;
  getActiveUser: () => { name: string; role: string };
  ingredients: Ingredient[];
  products: Product[];
}

export function useSupplyRequests({
  notify,
  getActiveUser,
  ingredients,
  products,
}: UseSupplyRequestsParams) {
  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_supply_requests');
      if (saved) return JSON.parse(saved) as SupplyRequest[];
    } catch {
      localStorage.removeItem('pan_erp_supply_requests');
    }
    // Sin demo data: las solicitudes con ids no-hex (`sup_req_1`, `sup_req_2`)
    // eran rechazadas por el backend. En prod arrancamos con lista vacía y la
    // panadería va creando solicitudes reales.
    return [];
  });

  useEffect(() => {
    safeSetItem('pan_erp_supply_requests', JSON.stringify(supplyRequests));
  }, [supplyRequests]);

  const requestSupply = (
    type: 'ingredient' | 'product',
    itemId: string,
    quantity: number,
    reason: string,
  ): void => {
    const activeUser = getActiveUser();
    let itemName: string;
    let unit: string;
    if (type === 'ingredient') {
      const ing = ingredients.find((i) => i.id === itemId);
      itemName = ing?.name ?? 'Materia Prima';
      unit = ing?.unit ?? 'kg';
    } else {
      const prod = products.find((p) => p.id === itemId);
      itemName = prod?.name ?? 'Producto';
      unit = 'unidades';
    }
    const roleLabel =
      activeUser.role === 'admin'
        ? 'Administración'
        : activeUser.role === 'cajero'
        ? 'Cajero'
        : 'Panadero';
    // UUID hex (32 chars, sin guiones) — formato esperado por el backend; el
    // prefijo `sup_req_` + base36 era rechazado por la validación.
    const reqId = crypto.randomUUID().replace(/-/g, '');
    const request: SupplyRequest = {
      id: reqId,
      type,
      itemId,
      itemName,
      quantity,
      unit,
      reason,
      requestedBy: `${activeUser.name} (${roleLabel})`,
      status: 'pending',
      date: new Date().toISOString(),
    };
    setSupplyRequests((prev) => [request, ...prev]);
    syncSupplyRequestToD1({
      id: request.id,
      type: request.type,
      itemId: request.itemId,
      itemName: request.itemName,
      quantity: request.quantity,
      unit: request.unit,
      reason: request.reason,
      requestedBy: request.requestedBy,
    }).catch(() => notify(
      '⚠️ Sync fallido',
      'La solicitud se guardó localmente pero no se sincronizó con el servidor.',
      'warning',
    ));
    notify(
      '🌾 Solicitud de Abastecimiento',
      `Nueva solicitud para ${quantity} ${unit} de "${itemName}": ${reason}`,
      'info',
    );
  };

  const rejectSupplyRequest = (requestId: string, adminMemo: string): void => {
    // Trabajamos siempre sobre `prev` dentro del setState para evitar leer
    // un `supplyRequests` stale del closure (típico si el caller dispara
    // varias acciones seguidas o si vino de un handler diferido).
    let rejectedReq: SupplyRequest | null = null;
    setSupplyRequests((prev) => {
      const target = prev.find((r) => r.id === requestId && r.status === 'pending');
      if (!target) return prev; // nada que cambiar → no triggerea re-render
      rejectedReq = { ...target, status: 'rejected' as const, adminMemo };
      return prev.map((r) => (r.id === requestId ? rejectedReq! : r));
    });

    // El setState es asíncrono pero el callback se ejecuta sincrónicamente, así
    // que después de este punto `rejectedReq` ya está poblado (o es null y
    // no hicimos cambios — abortamos).
    if (!rejectedReq) return;

    // Operamos sobre la copia capturada para que la notificación y el sync
    // remoto reflejen la versión recién actualizada, no el estado anterior.
    const finalReq = rejectedReq as SupplyRequest;
    notify(
      '❌ Abastecimiento Desestimado',
      `Se rechazó la solicitud para "${finalReq.itemName}". Comentario: ${adminMemo}`,
      'error',
    );

    updateSupplyRequestStatusInD1(requestId, 'rejected', adminMemo).catch(() => {
      notify(
        '⚠️ Sync fallido',
        'El rechazo se guardó localmente pero no se sincronizó con el servidor.',
        'warning',
      );
    });
  };

  return {
    supplyRequests,
    setSupplyRequests,
    requestSupply,
    rejectSupplyRequest,
  };
}
