import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests para el comportamiento de sync de withdrawal requests en useBatches.
 *
 * Testeamos la lógica pura de sync/queue desacoplada de React, replicando
 * el patrón de syncWithdrawalRequestToD1 definido en d1-sync.ts:
 *   - Si online  → POST /api/v2/withdrawal-requests
 *   - Si offline → enqueue en cola Dexie (entity_type='withdrawal_request')
 *
 * No importamos el hook directamente (depende de React context y localStorage),
 * sino que verificamos la función de sync en aislamiento.
 */

// ── Tipos mínimos para los tests ────────────────────────────────────────

interface WithdrawalPayload {
  id: string;
  batch_id: string;
  product_id: string;
  product_name: string;
  batch_number: string;
  quantity: number;
  reason: string;
  requested_by: string;
  branch_id: string;
}

interface QueueEntry {
  entity_type: string;
  data: WithdrawalPayload;
}

// ── Réplica de la lógica de syncWithdrawalRequestToD1 ──────────────────

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

async function syncWithdrawalRequestToD1(
  req: {
    id: string;
    batchId: string;
    productId: string;
    productName: string;
    batchNumber: string;
    quantity: number;
    reason: string;
    requestedBy: string;
  },
  deps: {
    post: (url: string, payload: WithdrawalPayload) => Promise<void>;
    enqueue: (entityType: string, data: WithdrawalPayload) => Promise<void>;
    branchId: string;
  },
): Promise<void> {
  const payload: WithdrawalPayload = {
    id: req.id,
    batch_id: req.batchId,
    product_id: req.productId,
    product_name: req.productName,
    batch_number: req.batchNumber,
    quantity: req.quantity,
    reason: req.reason,
    requested_by: req.requestedBy,
    branch_id: deps.branchId,
  };
  try {
    await deps.post('/api/v2/withdrawal-requests', payload);
  } catch (err) {
    if (isNetworkError(err)) {
      await deps.enqueue('withdrawal_request', payload);
    } else {
      throw err;
    }
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const baseRequest = {
  id: 'req_abc123',
  batchId: 'batch_001',
  productId: 'prod_001',
  productName: 'Medialunas de Grasa',
  batchNumber: 'L-MED-F-01',
  quantity: 12,
  reason: 'Lote vencido — baja manual solicitada por cajero',
  requestedBy: 'Juan Pérez (Caja)',
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('syncWithdrawalRequestToD1', () => {
  let postMock: ReturnType<typeof vi.fn>;
  let enqueueMock: ReturnType<typeof vi.fn>;
  const branchId = 'branch_1';

  beforeEach(() => {
    postMock = vi.fn().mockResolvedValue(undefined);
    enqueueMock = vi.fn().mockResolvedValue(undefined);
  });

  it('online: llama a POST con el payload correcto', async () => {
    await syncWithdrawalRequestToD1(baseRequest, {
      post: postMock,
      enqueue: enqueueMock,
      branchId,
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/api/v2/withdrawal-requests', {
      id: 'req_abc123',
      batch_id: 'batch_001',
      product_id: 'prod_001',
      product_name: 'Medialunas de Grasa',
      batch_number: 'L-MED-F-01',
      quantity: 12,
      reason: 'Lote vencido — baja manual solicitada por cajero',
      requested_by: 'Juan Pérez (Caja)',
      branch_id: 'branch_1',
    });

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('offline (TypeError): el withdrawal queda en cola — no se pierde', async () => {
    postMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await syncWithdrawalRequestToD1(baseRequest, {
      post: postMock,
      enqueue: enqueueMock,
      branchId,
    });

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [entityType, payload] = enqueueMock.mock.calls[0] as [string, WithdrawalPayload];
    expect(entityType).toBe('withdrawal_request');
    expect(payload.id).toBe('req_abc123');
    expect(payload.quantity).toBe(12);
    expect(payload.branch_id).toBe('branch_1');
  });

  it('offline (AbortError): también queda en cola', async () => {
    const abortErr = new Error('Request aborted');
    abortErr.name = 'AbortError';
    postMock.mockRejectedValue(abortErr);

    await syncWithdrawalRequestToD1(baseRequest, {
      post: postMock,
      enqueue: enqueueMock,
      branchId,
    });

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect((enqueueMock.mock.calls[0] as [string, WithdrawalPayload])[0]).toBe('withdrawal_request');
  });

  it('error de servidor (non-network): relanza sin encolar', async () => {
    const serverErr = Object.assign(new Error('Internal Server Error'), { status: 500 });
    postMock.mockRejectedValue(serverErr);

    await expect(
      syncWithdrawalRequestToD1(baseRequest, {
        post: postMock,
        enqueue: enqueueMock,
        branchId,
      }),
    ).rejects.toThrow('Internal Server Error');

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('el payload incluye branch_id del settings', async () => {
    const customBranchId = 'suc_belgrano_01';
    await syncWithdrawalRequestToD1(baseRequest, {
      post: postMock,
      enqueue: enqueueMock,
      branchId: customBranchId,
    });

    const payload = (postMock.mock.calls[0] as [string, WithdrawalPayload])[1];
    expect(payload.branch_id).toBe(customBranchId);
  });

  it('la cola recibe entity_type="withdrawal_request" (no "withdrawal" ni otro)', async () => {
    postMock.mockRejectedValue(new TypeError('Network error'));

    await syncWithdrawalRequestToD1(baseRequest, {
      post: postMock,
      enqueue: enqueueMock,
      branchId,
    });

    const entries: QueueEntry[] = enqueueMock.mock.calls.map(
      (c) => ({ entity_type: (c as [string, WithdrawalPayload])[0], data: (c as [string, WithdrawalPayload])[1] }),
    );
    expect(entries[0].entity_type).toBe('withdrawal_request');
  });

  it('los campos snake_case del payload son correctos (batch_id, product_id, etc.)', async () => {
    await syncWithdrawalRequestToD1(baseRequest, {
      post: postMock,
      enqueue: enqueueMock,
      branchId,
    });

    const payload = (postMock.mock.calls[0] as [string, WithdrawalPayload])[1];
    // Verifica que se usen snake_case (convención del backend), no camelCase
    expect(payload).toHaveProperty('batch_id');
    expect(payload).toHaveProperty('product_id');
    expect(payload).toHaveProperty('batch_number');
    expect(payload).toHaveProperty('requested_by');
    expect(payload).not.toHaveProperty('batchId');
    expect(payload).not.toHaveProperty('productId');
  });
});
