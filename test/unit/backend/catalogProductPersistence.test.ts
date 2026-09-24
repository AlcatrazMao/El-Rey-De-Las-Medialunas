import { describe, expect, it, vi } from 'vitest';
import { createCatalogProduct, validateProductDetails } from '../../../workers/api/src/lib/catalog-product';
import { normalizeClientSaleId } from '../../../workers/api/src/utils/id';

function fakeDb(existing: unknown = null) {
  const batch = vi.fn().mockResolvedValue([]);
  const db = { batch, prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args, first: async () => existing }) }) };
  return { db: db as unknown as D1Database, batch };
}
const product = { id: 'stable-id', code: 'PAN', name: 'Pan', unit: 'kg', price: 100, cost: 20, initial_stock: 2.75, supplier: 'Molino', shelf_life_days: 3 };
describe('shared REST/offline catalog writer', () => {
  it('preserves legacy sale IDs instead of creating unrelated server IDs', () => {
    expect(normalizeClientSaleId('sale_1727000000000_abc12')).toBe('sale_1727000000000_abc12');
    expect(normalizeClientSaleId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400e29b41d4a716446655440000');
    expect(normalizeClientSaleId('550e8400e29b41d4a716446655440000')).toBe('550e8400e29b41d4a716446655440000');
    expect(normalizeClientSaleId('../bad')).toBeNull();
    expect(normalizeClientSaleId('sale_1')).toBeNull();
  });
  it('creates product, fractional inventory and movement in one batch', async () => {
    const { db, batch } = fakeDb();
    expect(await createCatalogProduct(db, product, 'branch', 'category', 'user')).toBe('stable-id');
    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0][0];
    expect(statements).toHaveLength(3);
    expect(statements[0].args).toContain('kg');
    expect(statements[0].args).toContain('Molino');
    expect(statements[1].args).toContain(2.75);
    expect(statements[2].args).toContain(2.75);
  });
  it('replay never replenishes stock', async () => {
    const { db, batch } = fakeDb({ id: product.id, code: 'PAN', branch_id: 'branch', deleted_at: null });
    await createCatalogProduct(db, product, 'branch', 'category', 'user');
    expect(batch).not.toHaveBeenCalled();
  });
  it('does not accept identity from another branch', async () => {
    const { db } = fakeDb({ id: product.id, code: 'PAN', branch_id: 'other', deleted_at: null });
    await expect(createCatalogProduct(db, product, 'branch', 'category', 'user')).rejects.toThrow('CONFLICT');
  });
  it.each([{ unit: 'kilos' }, { unit: null }, { shelf_life_days: -1 }, { shelf_life_days: 1.5 }, { initial_stock: Infinity }, { supplier: {} }])('rejects invalid details %j', body => {
    expect(validateProductDetails(body)).not.toBeNull();
  });
  it('accepts kg and zero shelf life', () => {
    expect(validateProductDetails({ unit: 'kg', shelf_life_days: 0, initial_stock: .125 })).toBeNull();
  });
});
