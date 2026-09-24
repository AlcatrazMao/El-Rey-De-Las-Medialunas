// @vitest-environment node
// Real SQL + actual HTTP handlers, not a copy of the implementation.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productRoutes } from '../../../workers/api/src/routes/products';
import { createCatalogProduct } from '../../../workers/api/src/lib/catalog-product';
const { Hono } = createRequire(new URL('../../../workers/api/package.json', import.meta.url))('hono');

let sqlite: DatabaseSync;
let db: D1Database;
let app: InstanceType<typeof Hono>;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../../migrations/0028_product_details.sql', import.meta.url), 'utf8'));
  sqlite.exec(`INSERT INTO branches (id,name,code) VALUES ('branch','Central','CC');
    INSERT INTO users (id,firebase_uid,email,name,role) VALUES ('user','uid','test@example.invalid','Test','admin');
    INSERT INTO user_branches (user_id,branch_id,is_default) VALUES ('user','branch',1);
    INSERT INTO categories (id,branch_id,name) VALUES ('cat','branch','panes');`);
  function prepare(sql: string, args: unknown[] = []) {
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
    };
  }
  db = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  app = new Hono();
  app.use('*', async (c, next) => { c.set('userId', 'user'); c.set('userRole', 'admin'); c.set('branchId', 'branch'); await next(); });
  app.route('/products', productRoutes);
});
afterEach(() => sqlite.close());
const product = { id: 'client-id', code: 'PAN', name: 'Pan', branch_id: 'branch', category_id: 'cat', unit: 'kg', price: 100, initial_stock: 2.75, supplier: 'Molino', shelf_life_days: 2 };
function request(path: string, method = 'GET', body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db });
}
describe('catalog D1-compatible SQLite roundtrip', () => {
  it('create → edit kg/details → reload; replay preserves fractional stock', async () => {
    const created = await request('/products', 'POST', product);
    expect(created.status).toBe(201);
    expect((await created.json()).data.id).toBe('client-id');
    const updated = await request('/products/client-id', 'PUT', { unit: 'kg', supplier: 'Otro', description: 'Trigo', barcode: '779123', shelf_life_days: 0, storage_instructions: 'Frío', attributes: 'Integral', tax_rate: 0 });
    expect(updated.status).toBe(200);
    const reloaded = await request('/products?branch_id=branch');
    expect((await reloaded.json()).data[0]).toMatchObject({ id: 'client-id', unit: 'kg', supplier: 'Otro', description: 'Trigo', barcode: '779123', shelf_life_days: 0, storage_instructions: 'Frío', attributes: 'Integral', tax_rate: 0 });
    expect((await request('/products', 'POST', product)).status).toBe(201);
    expect(sqlite.prepare('SELECT current_quantity FROM inventory').get()?.current_quantity).toBe(2.75);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()?.n).toBe(1);
  });
  it('rolls back product AND stock when the movement fails', async () => {
    await expect(createCatalogProduct(db, product, 'branch', 'cat', 'nonexistent-user')).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM products').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory').get()?.n).toBe(0);
  });
  it('rejects unsupported units instead of returning success', async () => {
    expect((await request('/products', 'POST', { ...product, unit: 'kilos' })).status).toBe(400);
  });
  it('rejects missing category instead of silently assigning the first one', async () => {
    expect((await request('/products', 'POST', { ...product, category_id: '' })).status).toBe(400);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM products').get()?.n).toBe(0);
  });
});
