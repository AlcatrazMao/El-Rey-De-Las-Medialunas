import { useState, useEffect, useCallback } from 'react';

import { useApp } from '../AppContext';
import { API_URL, fetchWithAuth } from '../services/api';

import { resolveFallbackBranchId } from './useSettings';
import type { DocumentType } from './useDocumentSettings';

/**
 * Personalización de comprobantes (migración 0025). Dos niveles:
 *   - global: default para toda la cadena.
 *   - branch: override de la sucursal activa (null = hereda del global).
 * El backend devuelve `resolved` (merge) y los valores crudos `global`/`branch`.
 */
export interface DocumentCustomizationFields {
  title: string | null;
  header_text: string | null;
  footer_text: string | null;
  show_prices: boolean;
  show_tax: boolean;
  show_logo: boolean;
  show_qr: boolean;
  show_customer: boolean;
  show_operator: boolean;
  presupuesto_valid_days: number | null;
  nota_credito_require_reason: boolean;
  factura_fiscal_legend: string | null;
}

export interface DocumentCustomization {
  document_type: DocumentType;
  global: DocumentCustomizationFields;
  branch: DocumentCustomizationFields | null;
  resolved: DocumentCustomizationFields;
}

interface DocumentCustomizationsResponse {
  success: boolean;
  data: DocumentCustomization[];
}

export type CustomizationPatch = Partial<DocumentCustomizationFields> & {
  scope: 'global' | 'branch';
};

export function useDocumentCustomizations() {
  const { activeBranchId } = useApp();
  const [data, setData] = useState<DocumentCustomization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const branch = activeBranchId ?? resolveFallbackBranchId();
      const url = branch
        ? `${API_URL}/api/v2/document-customizations?branch_id=${encodeURIComponent(branch)}`
        : `${API_URL}/api/v2/document-customizations`;
      const res = await fetchWithAuth(url, {
        headers: branch ? { 'X-Branch-Id': branch } : undefined,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as DocumentCustomizationsResponse;
      if (body.success && Array.isArray(body.data)) {
        setData(body.data);
      }
    } catch {
      // Sin red / error: conservamos lo cargado.
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateCustomization = async (
    documentType: DocumentType,
    patch: CustomizationPatch,
  ): Promise<boolean> => {
    const previous = data;
    try {
      const branch = activeBranchId ?? resolveFallbackBranchId();
      const url = branch
        ? `${API_URL}/api/v2/document-customizations/${documentType}?branch_id=${encodeURIComponent(branch)}`
        : `${API_URL}/api/v2/document-customizations/${documentType}`;
      const res = await fetchWithAuth(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(branch ? { 'X-Branch-Id': branch } : {}),
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await refresh();
      return true;
    } catch {
      setData(previous);
      return false;
    }
  };

  return { data, isLoading, updateCustomization, refresh };
}
