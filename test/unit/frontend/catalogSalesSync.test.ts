import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSale: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(), products: vi.fn(), inventory: vi.fn(),
  categories: vi.fn(), enqueue: vi.fn(), markSynced: vi.fn(), getUnsynced: vi.fn(),
  incrementRetries: vi.fn(), permanent: vi.fn(), fetch: vi.fn(), queueAdd: vi.fn(),
  findError: vi.fn(), addError: vi.fn(), resolveError: vi.fn(), queuedChanges: vi.fn(), push: vi.fn(),
}));
vi.mock('../../../apps/pos-pc/src/config/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../../../apps/pos-pc/src/hooks/useSettings', () => ({ getSettings: () => ({ business: { branchId: 'branch-a' }, fiscal: { ivaRate: .21 } }) }));
vi.mock('../../../apps/pos-pc/src/services/api', () => ({
  API_URL: 'https://test.invalid', getActiveBranchId: () => 'branch-a',
  fetchWithAuth: mocks.fetch, isAccessTokenExpired: () => false, refreshAccessToken: vi.fn(),
  getApi: () => ({ sync: { push: mocks.push }, sales: { create: mocks.createSale }, products: { create: mocks.createProduct, update: mocks.updateProduct, getAll: mocks.products }, categories: { getAll: mocks.categories }, inventory: { getAll: mocks.inventory } }),
}));
vi.mock('../../../apps/pos-pc/src/services/db-adapter', () => ({ dbAdapter: { syncQueue: { add: mocks.queueAdd, toArray: mocks.queuedChanges } } }));
vi.mock('../../../apps/pos-pc/src/lib/idb', () => ({
  salesQueueStore: { enqueue: mocks.enqueue, markSynced: mocks.markSynced, getUnsynced: mocks.getUnsynced, incrementRetries: mocks.incrementRetries, markPermanentlyFailed: mocks.permanent },
  syncErrorStore: { findBySaleId: mocks.findError, add: mocks.addError, markResolved: mocks.resolveError },
}));

import { buildSalePayload, classifyError, fetchProductsFromD1, findServerCategoryId, normalizeCategoryName, syncProductToD1, syncProductUpdateToD1, syncSaleToD1 } from '../../../apps/pos-pc/src/services/d1-sync';
import { pushLegacyOperations } from '../../../apps/pos-pc/src/services/legacy-sale-sync';
import { flushSalesQueue } from '../../../apps/pos-pc/src/hooks/useSyncEngine';
import { rememberProductIdentity, reconcileSaleProductIds } from '../../../apps/pos-pc/src/services/product-identity';
import type { Sale } from '../../../apps/pos-pc/src/types';

const sale = { id: 'sale-local', branchId: 'branch-original', idempotencyKey: 'once', items: [{ productId: 'p1', quantity: .25, price: 100, subtotal: 25 }], subtotal_bruto: 25, total_final: 25, discount_total: 0, tax: 0, date: '2026-09-24T12:00:00Z', paymentMethod: 'efectivo' } as Sale;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.categories.mockResolvedValue([{ id: 'cat', name: 'panes' }]);
  mocks.queuedChanges.mockResolvedValue([]);
  mocks.inventory.mockResolvedValue({ data: [] });
  mocks.createSale.mockResolvedValue({ id: 'server-sale', document_number: 9 });
  mocks.getUnsynced.mockResolvedValue([{ id: sale.id, saleData: buildSalePayload(sale, .21), origin: 'web', createdAt: sale.date }]);
});

describe('actual catalog and sale synchronization', () => {
  it('classifies Spanish D1 category names including accents', () => {
    expect(normalizeCategoryName('Facturas')).toBe('facturas');
    expect(normalizeCategoryName('Café')).toBe('bebidas');
    expect(normalizeCategoryName('Salados')).toBe('salados');
    expect(normalizeCategoryName('Pastelería')).toBe('pasteleria');
    expect(normalizeCategoryName('Postres')).toBe('pasteleria');
    expect(normalizeCategoryName('Aguas y Jugos')).toBe('bebidas');
    expect(findServerCategoryId([{ id: 'root', name: 'Panadería' }, { id: 'fact', name: 'Facturas' }], 'facturas')).toBe('fact');
    expect(findServerCategoryId([{ id: 'root', name: 'Panadería' }], 'salados')).toBe('');
  });
  it('drains legacy catalog before sales, using each original branch', async () => {
    mocks.push.mockResolvedValue({ success: true, data: { processed: 1, failed: 0, errors: [] } });
    const result = await pushLegacyOperations([
      { client_id: 'sale-op', entity_type: 'sale', operation: 'create', data: { ...buildSalePayload(sale, .21) }, client_timestamp: sale.date },
      { client_id: 'product-op', entity_type: 'product', operation: 'create', data: { id: 'p1', branch_id: 'branch-original' }, client_timestamp: sale.date },
    ], 'branch-current');
    expect(result.data?.processed).toBe(2);
    expect(mocks.push.mock.calls[0][1]).toBe('branch-original');
    expect(mocks.push.mock.invocationCallOrder[0]).toBeLessThan(mocks.createSale.mock.invocationCallOrder[0]);
    expect(mocks.createSale.mock.calls[0][0].branch_id).toBe('branch-original');
  });
  it('preserves an offline kg edit over an older unit snapshot', async () => {
    mocks.products.mockResolvedValue({ data: [{ id: 'p1', unit: 'unit', code: 'PAN' }], pagination: { total: 1 } });
    mocks.queuedChanges.mockResolvedValue([{ entity_type: 'product', data: { id: 'p1', unit: 'kg' } }]);
    const result = await fetchProductsFromD1([{ id: 'p1', code: 'PAN', unit: 'kg' } as never], 'branch-a');
    expect(result[0].unit).toBe('kg');
  });
  it('does not move void or cash close ahead of its queued sale', async () => {
    mocks.push.mockResolvedValue({ success: true, data: { processed: 1, failed: 0, errors: [] } });
    await pushLegacyOperations([
      { client_id: 'sale-op', entity_type: 'sale', operation: 'create', data: { ...buildSalePayload(sale, .21) }, client_timestamp: sale.date },
      { client_id: 'void-op', entity_type: 'void_sale', operation: 'create', data: { id: sale.id }, client_timestamp: sale.date },
    ], 'branch-original');
    expect(mocks.createSale.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]);
  });
  it('loads all pages and reconciles old IDs by SKU without duplicating products', async () => {
    mocks.products.mockResolvedValueOnce({ data: [{ id: 'server-1', code: 'PAN', unit: 'kg' }], pagination: { total: 2 } })
      .mockResolvedValueOnce({ data: [{ id: 'server-2', code: 'OTRO', unit: 'g' }] });
    const result = await fetchProductsFromD1([{ id: 'old-local', code: 'PAN', unit: 'unit' } as never], 'branch-a');
    expect(result.map(p => p.id)).toEqual(['server-1', 'server-2']);
    expect(result[0].unit).toBe('kg');
    expect(mocks.products.mock.calls[1][0].offset).toBe(1);
    expect(reconcileSaleProductIds({ branch_id: 'branch-a', items: [{ product_id: 'old-local' }] }).items[0].product_id).toBe('server-1');
  });
  it('keeps identity, decimal stock and metadata on create', async () => {
    await syncProductToD1({ id: 'p1', code: 'PAN', name: 'Pan', category: 'panes', price: 100, cost: 40, minStock: .5, stock: 2.75, unit: 'kg', supplier: 'Molino', description: 'Trigo', durabilityDays: 3, taxRate: 0 });
    expect(mocks.createProduct).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', unit: 'kg', initial_stock: 2.75, tax_rate: 0, supplier: 'Molino', description: 'Trigo', shelf_life_days: 3 }));
  });
  it('uses percent (21), not fraction (.21), for default product VAT', async () => {
    await syncProductToD1({ id: 'p1', code: 'PAN', name: 'Pan', category: 'panes', price: 1, cost: 0, minStock: 0 });
    expect(mocks.createProduct.mock.calls[0][0].tax_rate).toBe(21);
  });
  it('sends clearing values and kg on edit', async () => {
    await syncProductUpdateToD1('p1', { unit: 'kg', supplier: '', attributes: '', taxRate: 0, maxStock: 4.5, storageInstructions: 'Frío' });
    expect(mocks.updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ unit: 'kg', supplier: '', attributes: '', tax_rate: 0, max_stock: 4.5, storage_instructions: 'Frío' }));
  });
  it('persists outbox before network and keeps original branch', async () => {
    await syncSaleToD1(sale);
    expect(mocks.enqueue.mock.invocationCallOrder[0]).toBeLessThan(mocks.createSale.mock.invocationCallOrder[0]);
    expect(mocks.createSale.mock.calls[0][0].branch_id).toBe('branch-original');
    expect(mocks.markSynced).toHaveBeenCalledWith(sale.id);
  });
  it('keeps failed network sale pending', async () => {
    mocks.createSale.mockRejectedValue(new Error('Request failed after 4 attempt(s): Failed to fetch'));
    await syncSaleToD1(sale);
    expect(mocks.markSynced).not.toHaveBeenCalled();
    expect(mocks.addError).toHaveBeenCalledWith(expect.objectContaining({ category: 'network' }));
  });
  it.each([401, 403, 400, 422])('recognizes ApiError.status %s without Response', status => {
    expect(classifyError({ status })).toBe(status < 400 || status === 401 || status === 403 ? 'auth' : 'validation');
  });
  it('does not acknowledge HTTP 200 containing operation failures', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { processed: 0, failed: 1 } }), { status: 200 }));
    expect(await flushSalesQueue()).toEqual({ flushed: 0, failed: 1 });
    expect(mocks.markSynced).not.toHaveBeenCalled();
  });
  it('replays via canonical endpoint with original branch header', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id: 'server-sale' } })));
    expect(await flushSalesQueue()).toEqual({ flushed: 1, failed: 0 });
    expect(mocks.fetch).toHaveBeenCalledWith('https://test.invalid/api/v1/sales', expect.objectContaining({ headers: expect.objectContaining({ 'X-Branch-Id': 'branch-original' }) }));
  });
  it.each([401, 403, 429, 500])('keeps retryable HTTP %s in outbox', async status => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status }));
    await flushSalesQueue();
    expect(mocks.markSynced).not.toHaveBeenCalled();
    expect(mocks.permanent).not.toHaveBeenCalled();
  });
  it('reconciles legacy IDs only within the original branch', () => {
    rememberProductIdentity('branch-original', 'p1', 'canonical');
    expect(reconcileSaleProductIds(buildSalePayload(sale, .21)).items[0].product_id).toBe('canonical');
    expect(reconcileSaleProductIds({ branch_id: 'other', items: [{ product_id: 'p1' }] }).items[0].product_id).toBe('p1');
  });
});
