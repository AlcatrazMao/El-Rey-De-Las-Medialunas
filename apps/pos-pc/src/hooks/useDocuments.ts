import { useCallback, useState } from 'react';

import { API_URL, fetchWithAuth } from '../services/api';

// ============================================================================
// useDocuments.ts — creación de Remito/Presupuesto/Nota de Crédito (change
// "Document Types / Comprobantes"). Sin versionado/IDB ni polling (mismo
// criterio que useTransfers): son operaciones administrativas puntuales, no
// forman parte del flujo offline-first de venta — si falla la red, el
// cajero reintenta manualmente.
//
// Los 3 endpoints backend devuelven `sale_number` como el número correlativo
// real (columna propia de `remitos`/`budgets`/`credit_notes`, poblada desde
// `document_sequences` — NO confundir con el `sale_number` legacy de
// `sales`). Acá lo renombramos a `document_number` en el resultado que
// devolvemos al caller para alinear con el contrato `PrintSale.document_number`
// que espera print-bridge/exportUtils.
// ============================================================================

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

export interface RemitoItemInput {
  product_id: string;
  quantity: number;
  description?: string;
}

export interface CreateRemitoPayload {
  customer_id?: string;
  items: RemitoItemInput[];
  notes?: string;
}

export interface RemitoResult {
  id: string;
  document_number: number;
  customer_id: string | null;
  notes: string | null;
  created_at: string;
}

interface RemitoApiResponse {
  success: boolean;
  data: {
    id: string;
    branch_id: string;
    customer_id: string | null;
    sale_number: number;
    notes: string | null;
    created_at: string;
  };
}

export interface BudgetItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface CreateBudgetPayload {
  customer_id?: string;
  items: BudgetItemInput[];
  valid_until: string;
}

export interface BudgetResult {
  id: string;
  document_number: number;
  customer_id: string | null;
  valid_until: string;
  subtotal: number;
  total: number;
  created_at: string;
}

interface BudgetApiResponse {
  success: boolean;
  data: {
    id: string;
    branch_id: string;
    customer_id: string | null;
    sale_number: number;
    valid_until: string;
    subtotal: number;
    total: number;
    status: string;
    created_at: string;
  };
}

export interface CreateCreditNoteItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  batch_id?: string;
}

export interface CreateCreditNotePayload {
  // Modo A: referenciando una venta existente.
  sale_id?: string;
  // Modo B: devolución standalone desde el carrito (revierte stock + caja).
  cash_session_id?: string;
  items?: CreateCreditNoteItemInput[];
  reason: string;
  amount?: number;
}

export interface CreditNoteResult {
  id: string;
  document_number: number;
  sale_id: string | null;
  reason: string;
  amount: number;
  created_at: string;
}

interface CreditNoteApiResponse {
  success: boolean;
  data: {
    id: string;
    branch_id: string;
    sale_id: string | null;
    sale_number: number;
    reason: string;
    amount: number;
    created_at: string;
  };
}

export interface DocumentActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Hook con las 3 operaciones de creación de comprobantes no-venta. Cada
 * `create*` llama a `fetchWithAuth` (que ya manda `X-Branch-Id`) y devuelve
 * un resultado normalizado con `document_number` listo para imprimir.
 */
export function useDocuments() {
  const [submitting, setSubmitting] = useState(false);

  const createRemito = useCallback(async (payload: CreateRemitoPayload): Promise<DocumentActionResult<RemitoResult>> => {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/remitos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await readErrorMessage(res, `Error ${res.status}`) };
      const body = (await res.json()) as RemitoApiResponse;
      if (!body.success) return { ok: false, error: 'Respuesta inesperada del servidor' };
      return {
        ok: true,
        data: {
          id: body.data.id,
          document_number: body.data.sale_number,
          customer_id: body.data.customer_id,
          notes: body.data.notes,
          created_at: body.data.created_at,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error de red' };
    } finally {
      setSubmitting(false);
    }
  }, []);

  const createBudget = useCallback(async (payload: CreateBudgetPayload): Promise<DocumentActionResult<BudgetResult>> => {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await readErrorMessage(res, `Error ${res.status}`) };
      const body = (await res.json()) as BudgetApiResponse;
      if (!body.success) return { ok: false, error: 'Respuesta inesperada del servidor' };
      return {
        ok: true,
        data: {
          id: body.data.id,
          document_number: body.data.sale_number,
          customer_id: body.data.customer_id,
          valid_until: body.data.valid_until,
          subtotal: body.data.subtotal,
          total: body.data.total,
          created_at: body.data.created_at,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error de red' };
    } finally {
      setSubmitting(false);
    }
  }, []);

  const createCreditNote = useCallback(async (payload: CreateCreditNotePayload): Promise<DocumentActionResult<CreditNoteResult>> => {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/credit-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await readErrorMessage(res, `Error ${res.status}`) };
      const body = (await res.json()) as CreditNoteApiResponse;
      if (!body.success) return { ok: false, error: 'Respuesta inesperada del servidor' };
      return {
        ok: true,
        data: {
          id: body.data.id,
          document_number: body.data.sale_number,
          sale_id: body.data.sale_id,
          reason: body.data.reason,
          amount: body.data.amount,
          created_at: body.data.created_at,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error de red' };
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submitting, createRemito, createBudget, createCreditNote };
}
