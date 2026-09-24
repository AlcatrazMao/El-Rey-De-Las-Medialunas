import { genId } from '../utils/id';
import { nowSqliteTs } from '../utils/time';

export const PRODUCT_DETAIL_TEXT_FIELDS = ['supplier', 'attributes', 'storage_instructions'] as const;
const UNITS = new Set(['unit', 'kg', 'g', 'l', 'ml', 'dozen', 'pack']);

/** Shared by REST and offline writes: reject bad units instead of silently replacing them. */
export function validateProductDetails(body: Record<string, unknown>): string | null {
  if (body.unit !== undefined && !UNITS.has(String(body.unit))) return 'Unidad de medida inválida';
  for (const field of ['description', 'barcode', ...PRODUCT_DETAIL_TEXT_FIELDS]) {
    const value = body[field];
    if (value != null && (typeof value !== 'string' || value.length > (field === 'barcode' ? 128 : 2000))) {
      return `${field} debe ser texto de longitud válida`;
    }
  }
  if (body.shelf_life_days != null && (!Number.isInteger(body.shelf_life_days) || Number(body.shelf_life_days) < 0 || Number(body.shelf_life_days) > 36500)) {
    return 'Vida útil inválida: usar días enteros entre 0 y 36500';
  }
  if (body.initial_stock !== undefined && (typeof body.initial_stock !== 'number' || !Number.isFinite(body.initial_stock) || body.initial_stock < 0 || body.initial_stock > 10_000_000)) {
    return 'Stock inicial inválido';
  }
  return null;
}

/** One ID and one atomic initial stock operation across online/offline retries. */
export async function createCatalogProduct(db: D1Database, body: Record<string, unknown>, branchId: string, categoryId: string | null, userId: string): Promise<string> {
  const detailError = validateProductDetails(body);
  if (detailError) throw new Error(`VALIDATION_ERROR: ${detailError}`);
  const id = body.id === undefined ? genId() : String(body.id);
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id)) throw new Error('VALIDATION_ERROR: ID de producto inválido');
  const existing = await db.prepare('SELECT id, code, branch_id, deleted_at FROM products WHERE id = ? LIMIT 1').bind(id)
    .first<{ id: string; code: string; branch_id: string; deleted_at: string | null }>();
  if (existing) {
    if (existing.branch_id !== branchId || existing.code !== body.code || existing.deleted_at) throw new Error('CONFLICT: ID de producto ya utilizado');
    return id;
  }
  const now = nowSqliteTs();
  const quantity = Number(body.initial_stock ?? 0);
  const min = Number(body.min_stock ?? 0);
  const max = Number(body.max_stock ?? 999999);
  await db.batch([
    db.prepare(`INSERT INTO products
      (id, code, name, description, barcode, category_id, branch_id, unit, price, cost, tax_rate, min_stock, max_stock,
       is_raw_material, is_producible, track_inventory, is_active, supplier, attributes, shelf_life_days, storage_instructions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`)
      .bind(id, String(body.code).trim(), String(body.name).trim(), body.description ?? null, body.barcode ?? null, categoryId, branchId,
        body.unit ?? 'unit', body.price, body.cost ?? 0, body.tax_rate ?? 21, min, max, body.is_raw_material ? 1 : 0, body.is_producible ? 1 : 0,
        body.supplier ?? null, body.attributes ?? null, body.shelf_life_days ?? null, body.storage_instructions ?? null, now, now),
    db.prepare(`INSERT INTO inventory (id, product_id, branch_id, current_quantity, min_stock, max_stock, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(genId(), id, branchId, quantity, min, max, now),
    ...(quantity > 0 ? [db.prepare(`INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
      VALUES (?, ?, ?, 'adjustment_in', ?, 'Stock inicial de producto', ?, ?)`)
      .bind(genId(), id, branchId, quantity, userId, now)] : []),
  ]);
  return id;
}
