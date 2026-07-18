import { useState, useEffect, useCallback } from 'react';

import { useApp } from '../AppContext';
import { API_URL, fetchWithAuth } from '../services/api';

/**
 * Los 7 tipos de comprobante emitibles (change "Document Types / Comprobantes").
 * Mismo enum que usa el backend (`workers/api/src/routes/document-settings.ts`)
 * y `apps/print-bridge/src/types.ts::DocumentType`.
 */
export type DocumentType =
  | 'ticket'
  | 'factura_a'
  | 'factura_b'
  | 'factura_c'
  | 'nota_credito'
  | 'remito'
  | 'presupuesto';

export interface DocumentTypeSetting {
  document_type: DocumentType;
  enabled: boolean;
}

/** Forma cruda que devuelve GET /api/v2/document-settings. */
interface DocumentSettingsResponse {
  success: boolean;
  data: DocumentTypeSetting[];
}

/**
 * Hook de lectura/escritura de los toggles de tipo de comprobante por sucursal
 * activa. Mismo patrón que `useBatches`: fetch on-mount (sin polling — los
 * toggles cambian raramente y siempre por acción explícita de un admin, no
 * hace falta refrescar cada 60s como el stock de lotes) + refetch manual tras
 * cada `updateSetting` para que la UI refleje inmediatamente lo persistido.
 *
 * También refetchea cuando cambia `activeBranchId` (admin/owner/supervisor
 * cambiando de sucursal desde el selector): sin esto, los toggles quedaban
 * pisados con los de la sucursal anterior hasta un reload completo, aunque
 * `fetchWithAuth` ya mande el `X-Branch-Id` correcto (services/api.ts).
 */
export function useDocumentSettings() {
  const { activeBranchId } = useApp();
  const [data, setData] = useState<DocumentTypeSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/document-settings`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as DocumentSettingsResponse;
      if (body.success && Array.isArray(body.data)) {
        setData(body.data);
      }
    } catch {
      // Sin red / error de servidor: conservamos lo que ya teníamos cargado.
      // El caller (POSView) debe tolerar data=[] y no bloquear la venta.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, activeBranchId]);

  /**
   * Actualiza el flag enabled/disabled de un tipo. Optimista: refleja el
   * cambio localmente y luego confirma contra el servidor con un refetch;
   * si el PATCH falla, revierte pidiendo el estado real de nuevo.
   */
  const updateSetting = async (documentType: DocumentType, enabled: boolean): Promise<boolean> => {
    const previous = data;
    setData(prev => prev.map(d => (d.document_type === documentType ? { ...d, enabled } : d)));
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/document-settings/${documentType}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return true;
    } catch {
      setData(previous);
      return false;
    }
  };

  return { data, isLoading, updateSetting, refresh };
}
