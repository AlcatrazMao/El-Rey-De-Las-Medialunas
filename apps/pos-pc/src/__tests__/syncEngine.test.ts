import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks para módulos pesados ────────────────────────────────────────────
// El motor real importa firebase, api-client, etc. Acá mockeamos lo justo
// para que los tests corran sin red ni dependencias externas.

const mockGetIdToken = vi.fn(async () => 'fake-id-token');
vi.mock('../config/firebase', () => ({
  auth: {
    currentUser: { getIdToken: mockGetIdToken },
  },
}));

const mockSalesCreate = vi.fn();
vi.mock('../services/api', () => ({
  API_URL: 'http://test.local',
  fetchWithAuth: vi.fn(),
  getApi: () => ({
    sales: { create: mockSalesCreate },
    sync: { push: vi.fn(), pull: vi.fn() },
  }),
}));

// Mock del store IndexedDB con una implementación en memoria.
type StoredError = {
  id?: number;
  sale_id: string;
  category: string;
  message: string;
  payload: string;
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
  resolved_at: string | null;
  status: string;
};

const memory: StoredError[] = [];
let nextId = 1;

vi.mock('../lib/idb', () => ({
  syncErrorStore: {
    async add(err: Omit<StoredError, 'id'>) {
      const id = nextId++;
      memory.push({ id, ...err });
      return id;
    },
    async put(err: StoredError) {
      const idx = memory.findIndex(e => e.id === err.id);
      if (idx >= 0) memory[idx] = err;
      else memory.push(err);
    },
    async getAll() {
      return [...memory];
    },
    async getPending() {
      return memory.filter(e => e.resolved_at === null);
    },
    async getPendingByCategory(category: string) {
      return memory.filter(e => e.resolved_at === null && e.category === category);
    },
    async findBySaleId(saleId: string) {
      return memory.find(e => e.sale_id === saleId && e.resolved_at === null);
    },
    async get(id: number) {
      return memory.find(e => e.id === id);
    },
    async markResolved(id: number) {
      const e = memory.find(x => x.id === id);
      if (e) { e.resolved_at = new Date().toISOString(); e.status = 'resolved'; }
    },
    async resetForRetry(id: number) {
      const e = memory.find(x => x.id === id);
      if (e) { e.attempts = 0; e.next_retry_at = new Date().toISOString(); e.status = 'pending'; }
    },
    async updatePayload(id: number, payload: string) {
      const e = memory.find(x => x.id === id);
      if (e) e.payload = payload;
    },
    async incrementAttempt(id: number, nextRetryAt: string | null, status: string) {
      const e = memory.find(x => x.id === id);
      if (e) { e.attempts += 1; e.next_retry_at = nextRetryAt; e.status = status; }
    },
  },
}));

// Mock de useSettings (lo usa d1-sync para branchId/ivaRate)
vi.mock('../hooks/useSettings', () => ({
  getSettings: () => ({
    business: { branchId: 'branch_test' },
    fiscal: { ivaRate: 0.21 },
  }),
}));

// Importamos DESPUÉS de declarar mocks.
const { persistSyncError, classifyError } = await import('../services/d1-sync');

describe('persistSyncError — crea record con next_retry_at (caso network)', () => {
  beforeEach(() => {
    memory.length = 0;
    nextId = 1;
    mockSalesCreate.mockReset();
    mockGetIdToken.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persiste un error categoría=network con next_retry_at definido', async () => {
    await persistSyncError({
      saleId: 'sale_test_1',
      category: 'network',
      message: 'Failed to fetch',
      payload: { id: 'sale_test_1', total_final: 100 },
    });

    expect(memory.length).toBe(1);
    const rec = memory[0];
    expect(rec.sale_id).toBe('sale_test_1');
    expect(rec.category).toBe('network');
    expect(rec.attempts).toBe(0);
    expect(rec.next_retry_at).not.toBeNull();
    expect(rec.resolved_at).toBeNull();
    expect(rec.status).toBe('pending');
    // payload está JSON-stringified
    expect(() => JSON.parse(rec.payload)).not.toThrow();
  });

  it('no duplica si ya existe un pending para el mismo sale_id', async () => {
    await persistSyncError({
      saleId: 'sale_dup',
      category: 'network',
      message: 'first',
      payload: { id: 'sale_dup' },
    });
    await persistSyncError({
      saleId: 'sale_dup',
      category: 'server',
      message: 'second',
      payload: { id: 'sale_dup' },
    });
    expect(memory.length).toBe(1);
    expect(memory[0].message).toBe('first');
  });

  it('classifyError clasifica 401 como auth — confirma flujo del scheduler de re-auth', () => {
    // navigator.onLine es true en happy-dom por default
    const cat = classifyError(new Error('Unauthorized'), { status: 401 } as Response);
    expect(cat).toBe('auth');
  });
});
