import { useState, useEffect } from 'react';
import { safeSetItem } from '../utils/safeStorage';
import { syncSupplyRequestToD1, updateSupplyRequestStatusInD1 } from '../services/d1-sync';
import type { SupplyRequest, Ingredient, Product } from '../types';

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
    return [
      {
        id: 'sup_req_1',
        type: 'ingredient',
        itemId: 'ing_harina',
        itemName: 'Harina de Trigo 0000',
        quantity: 50,
        unit: 'kg',
        reason: 'Reposición urgente para elaboración de pan del fin de semana.',
        requestedBy: 'Laura (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 5400000).toISOString(),
      },
      {
        id: 'sup_req_2',
        type: 'product',
        itemId: 'prod_pan_flauta',
        itemName: 'Pan Flauta (Baguette)',
        quantity: 40,
        unit: 'unidades',
        reason: 'Lote fresco caliente listo para transferir a mostrador.',
        requestedBy: 'Laura (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 1800000).toISOString(),
      },
    ];
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
    const reqId = `sup_req_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
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
    }).catch(() => {});
    notify(
      '🌾 Solicitud de Abastecimiento',
      `Nueva solicitud para ${quantity} ${unit} de "${itemName}": ${reason}`,
      'info',
    );
  };

  const rejectSupplyRequest = (requestId: string, adminMemo: string): void => {
    setSupplyRequests((prev) =>
      prev.map((r) => {
        if (r.id !== requestId || r.status !== 'pending') return r;
        const req: SupplyRequest = { ...r, status: 'rejected', adminMemo };
        notify(
          '❌ Abastecimiento Desestimado',
          `Se rechazó la solicitud para "${req.itemName}". Comentario: ${adminMemo}`,
          'error',
        );
        return req;
      }),
    );
    updateSupplyRequestStatusInD1(requestId, 'rejected', adminMemo).catch(() => {});
  };

  return {
    supplyRequests,
    setSupplyRequests,
    requestSupply,
    rejectSupplyRequest,
  };
}
