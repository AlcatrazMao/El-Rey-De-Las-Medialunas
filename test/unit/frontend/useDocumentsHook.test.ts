import { describe, it, expect, vi } from 'vitest';

/**
 * Tests para apps/pos-pc/src/hooks/useDocuments.ts — createRemito/createBudget/
 * createCreditNote.
 *
 * Mismo criterio que test/unit/frontend/withdrawalSync.test.ts: el hook depende
 * de React (useState/useCallback) y de fetchWithAuth (que a su vez depende del
 * singleton de sesión en services/api.ts) — en vez de montar el hook con
 * renderHook (RTL no está instalado en el repo), replicamos la lógica pura de
 * cada create* como función que recibe un `post` inyectado, calcando byte a
 * byte la normalización real de apps/pos-pc/src/hooks/useDocuments.ts:
 *
 *   - Los 3 endpoints backend (POST /api/v2/remitos, /budgets, /credit-notes)
 *     devuelven `sale_number` (columna real poblada desde document_sequences).
 *   - El hook renombra ese campo a `document_number` en el resultado que
 *     expone al resto del frontend (contrato PrintSale.document_number).
 *
 * Body cases (!res.ok, !body.success, catch) también se replican tal cual
 * están en el hook para blindar la normalización contra las 3 formas de fallo.
 */

interface ApiErrorBody {
  error?: { message?: string };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

async function readErrorMessage(res: FakeResponse, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiErrorBody;
    return data?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

// ── Réplica de createRemito ────────────────────────────────────────────────

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

interface DocumentActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function createRemito(
  payload: unknown,
  deps: { post: (payload: unknown) => Promise<FakeResponse> },
): Promise<DocumentActionResult<{ id: string; document_number: number; customer_id: string | null; notes: string | null; created_at: string }>> {
  try {
    const res = await deps.post(payload);
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
  }
}

// ── Réplica de createBudget ─────────────────────────────────────────────────

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

async function createBudget(
  payload: unknown,
  deps: { post: (payload: unknown) => Promise<FakeResponse> },
): Promise<DocumentActionResult<{ id: string; document_number: number; customer_id: string | null; valid_until: string; subtotal: number; total: number; created_at: string }>> {
  try {
    const res = await deps.post(payload);
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
  }
}

// ── Réplica de createCreditNote ──────────────────────────────────────────────

interface CreditNoteApiResponse {
  success: boolean;
  data: {
    id: string;
    branch_id: string;
    sale_id: string;
    sale_number: number;
    reason: string;
    amount: number;
    created_at: string;
  };
}

async function createCreditNote(
  payload: unknown,
  deps: { post: (payload: unknown) => Promise<FakeResponse> },
): Promise<DocumentActionResult<{ id: string; document_number: number; sale_id: string; reason: string; amount: number; created_at: string }>> {
  try {
    const res = await deps.post(payload);
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
  }
}

function okResponse(data: unknown): FakeResponse {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

describe('useDocuments: normalización sale_number -> document_number', () => {
  describe('createRemito', () => {
    it('normaliza sale_number del backend a document_number en el resultado', async () => {
      const post = vi.fn().mockResolvedValue(
        okResponse({ id: 'rem_1', branch_id: 'b1', customer_id: 'cust_1', sale_number: 42, notes: 'nota', created_at: '2026-07-11T00:00:00.000Z' }),
      );
      const result = await createRemito({ items: [] }, { post });

      expect(result.ok).toBe(true);
      expect(result.data?.document_number).toBe(42);
      // No debe filtrarse el nombre crudo del backend al contrato del frontend.
      expect(result.data).not.toHaveProperty('sale_number');
    });

    it('res.ok=false: devuelve error legible sin normalizar nada', async () => {
      const post = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Producto inválido' } }) });
      const result = await createRemito({ items: [] }, { post });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Producto inválido');
      expect(result.data).toBeUndefined();
    });

    it('res.ok=false sin body de error parseable: usa fallback "Error {status}"', async () => {
      const post = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
      const result = await createRemito({ items: [] }, { post });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Error 500');
    });

    it('body.success=false: error de "respuesta inesperada"', async () => {
      const post = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: false }) });
      const result = await createRemito({ items: [] }, { post });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Respuesta inesperada del servidor');
    });

    it('fetch lanza (error de red): message del Error propagado', async () => {
      const post = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const result = await createRemito({ items: [] }, { post });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Failed to fetch');
    });
  });

  describe('createBudget', () => {
    it('normaliza sale_number a document_number y preserva subtotal/total/valid_until', async () => {
      const post = vi.fn().mockResolvedValue(
        okResponse({
          id: 'bud_1', branch_id: 'b1', customer_id: null, sale_number: 7,
          valid_until: '2026-08-01', subtotal: 1000, total: 1210, status: 'pending', created_at: '2026-07-11T00:00:00.000Z',
        }),
      );
      const result = await createBudget({ items: [], valid_until: '2026-08-01' }, { post });

      expect(result.ok).toBe(true);
      expect(result.data?.document_number).toBe(7);
      expect(result.data?.subtotal).toBe(1000);
      expect(result.data?.total).toBe(1210);
      expect(result.data?.valid_until).toBe('2026-08-01');
      expect(result.data).not.toHaveProperty('sale_number');
    });

    it('body.success=false: error de "respuesta inesperada"', async () => {
      const post = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: false }) });
      const result = await createBudget({ items: [], valid_until: '2026-08-01' }, { post });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Respuesta inesperada del servidor');
    });
  });

  describe('createCreditNote', () => {
    it('normaliza sale_number a document_number y preserva sale_id/reason/amount', async () => {
      const post = vi.fn().mockResolvedValue(
        okResponse({ id: 'cn_1', branch_id: 'b1', sale_id: 'sale_99', sale_number: 15, reason: 'Devolución', amount: 500, created_at: '2026-07-11T00:00:00.000Z' }),
      );
      const result = await createCreditNote({ sale_id: 'sale_99', reason: 'Devolución', amount: 500 }, { post });

      expect(result.ok).toBe(true);
      expect(result.data?.document_number).toBe(15);
      expect(result.data?.sale_id).toBe('sale_99');
      expect(result.data?.reason).toBe('Devolución');
      expect(result.data?.amount).toBe(500);
      expect(result.data).not.toHaveProperty('sale_number');
    });

    it('error 404 (venta original inexistente): propaga mensaje del backend', async () => {
      const post = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: 'Venta original no encontrada' } }) });
      const result = await createCreditNote({ sale_id: 'no_existe', reason: 'x', amount: 10 }, { post });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Venta original no encontrada');
    });
  });
});
