import { useState, useEffect, useCallback } from 'react';

import { API_URL, fetchWithAuth } from '../services/api';
import type { TransferOrder, TransferRecommendation } from '../types';

interface TransfersListResponse {
  success: boolean;
  data: TransferOrder[];
}

interface RecommendationsResponse {
  success: boolean;
  data: TransferRecommendation[];
}

interface ApiErrorBody {
  error?: { message?: string };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiErrorBody;
    return data?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Hook simple para el panel de transfers: sin versionado/IDB (a diferencia de
 * useRequests/useBatches) porque el volumen de traslados entre sucursales es
 * bajo y no necesita funcionar offline — es una operación administrativa, no
 * parte del flujo de venta. Refetch manual tras cada acción (crear/aprobar/
 * rechazar/enviar/recibir), igual que el patrón invalidate() de useRequests.
 */
export function useTransfers() {
  const [transfers, setTransfers] = useState<TransferOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/transfers`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const body = (await res.json()) as TransfersListResponse;
      if (body.success && Array.isArray(body.data)) {
        setTransfers(body.data);
        setError(null);
      }
    } catch {
      setError('No se pudieron cargar los traslados. Reintentá.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const createTransfer = useCallback(async (payload: {
    source_branch_id?: string;
    destination_branch_id: string;
    notes?: string;
    items: { product_id: string; quantity: number; notes?: string }[];
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await readErrorMessage(res, `Error ${res.status}`) };
      await fetchAll();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error de red' };
    }
  }, [fetchAll]);

  const transitionTransfer = useCallback(async (
    id: string,
    action: 'approve' | 'reject' | 'ship' | 'receive',
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/transfers/${id}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return { ok: false, error: await readErrorMessage(res, `Error ${res.status}`) };
      await fetchAll();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error de red' };
    }
  }, [fetchAll]);

  return {
    transfers,
    loading,
    error,
    refetch: fetchAll,
    createTransfer,
    approveTransfer: (id: string, admin_note?: string) => transitionTransfer(id, 'approve', admin_note ? { admin_note } : undefined),
    rejectTransfer: (id: string, rejection_reason?: string) => transitionTransfer(id, 'reject', rejection_reason ? { rejection_reason } : undefined),
    shipTransfer: (id: string) => transitionTransfer(id, 'ship'),
    receiveTransfer: (id: string, items?: { item_id: string; received_quantity: number }[]) =>
      transitionTransfer(id, 'receive', items ? { items } : undefined),
  };
}

/**
 * Recomendaciones de traslado (stock bajo en una sucursal vs. superávit en
 * otra). Se usa tanto en el Dashboard (banner) como al prellenar el form de
 * creación de un transfer nuevo.
 */
export function useTransferRecommendations(branchId: string | null) {
  const [recommendations, setRecommendations] = useState<TransferRecommendation[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecommendations = useCallback(async (): Promise<void> => {
    if (!branchId) {
      setRecommendations([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/transfers/recommendations?branch_id=${encodeURIComponent(branchId)}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const body = (await res.json()) as RecommendationsResponse;
      if (body.success && Array.isArray(body.data)) {
        setRecommendations(body.data);
      }
    } catch {
      // Silencioso: es un banner informativo, no bloquea el resto del dashboard.
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void fetchRecommendations();
  }, [fetchRecommendations]);

  return { recommendations, loading, refetch: fetchRecommendations };
}
