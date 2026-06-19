import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const productRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

const DEFAULT_BRANCH = "00000000000000000000000000000001";
// SECURITY: cap monetary fields so a malicious client cannot persist Infinity.
const MAX_PRICE = 10_000_000;
const MAX_TAX_RATE = 100;
const MAX_STOCK_BOUND = 10_000_000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// SECURITY: only catalog-management roles can create/modify/delete products.
function canManageProducts(role: string | undefined): boolean {
  return role === "admin" || role === "owner" || role === "supervisor";
}

// GET /
productRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "200", 10) || 200), 500);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const search = c.req.query("search");

  let query =
    "SELECT * FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  let countQuery =
    "SELECT COUNT(*) as total FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  const bindings: (string | number)[] = [branchId];
  const countBindings: (string | number)[] = [branchId];

  if (search) {
    const like = `%${escapeLike(search)}%`;
    query += " AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')";
    countQuery += " AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')";
    bindings.push(like, like);
    countBindings.push(like, like);
  }

  query += " ORDER BY name ASC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const [results, countResult] = await Promise.all([
    db.prepare(query).bind(...bindings).all(),
    db.prepare(countQuery).bind(...countBindings).first<{ total: number }>(),
  ]);

  return c.json({
    success: true,
    data: results.results ?? [],
    pagination: {
      total: countResult?.total ?? 0,
      limit,
      offset,
    },
  });
});

// GET /search — quick search via `q` param
productRoutes.get("/search", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "200", 10) || 200), 500);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const q = c.req.query("q");

  let query =
    "SELECT * FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  let countQuery =
    "SELECT COUNT(*) as total FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  const bindings: (string | number)[] = [branchId];
  const countBindings: (string | number)[] = [branchId];

  if (q) {
    const like = `%${escapeLike(q)}%`;
    query += " AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')";
    countQuery += " AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')";
    bindings.push(like, like);
    countBindings.push(like, like);
  }

  query += " ORDER BY name ASC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const [results, countResult] = await Promise.all([
    db.prepare(query).bind(...bindings).all(),
    db.prepare(countQuery).bind(...countBindings).first<{ total: number }>(),
  ]);

  return c.json({
    success: true,
    data: results.results ?? [],
    pagination: {
      total: countResult?.total ?? 0,
      limit,
      offset,
    },
  });
});

// GET /:id
productRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const product = await db
    .prepare(
      "SELECT * FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    )
    .bind(id)
    .first();

  if (!product) {
    return c.json(errBody("NOT_FOUND", "Producto no encontrado"), 404);
  }

  return c.json({ success: true, data: product });
});

// POST /
productRoutes.post("/", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageProducts(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear productos"), 403);
  }

  const db = c.env.DB;
  const body = await c.req.json<{
    code: string;
    name: string;
    description?: string;
    barcode?: string;
    category_id?: string;
    branch_id?: string;
    unit?: string;
    price: number;
    cost?: number;
    tax_rate?: number;
    min_stock?: number;
    max_stock?: number;
    is_raw_material?: boolean;
    is_producible?: boolean;
  }>();

  if (!body.code?.trim()) return c.json(errBody("VALIDATION_ERROR", "code es requerido"), 400);
  if (!body.name?.trim()) return c.json(errBody("VALIDATION_ERROR", "name es requerido"), 400);
  if (
    typeof body.price !== "number" ||
    !Number.isFinite(body.price) ||
    body.price < 0 ||
    body.price > MAX_PRICE
  ) {
    return c.json(errBody("VALIDATION_ERROR", "price debe ser un número finito >= 0"), 400);
  }
  if (
    body.cost !== undefined &&
    body.cost !== null &&
    (typeof body.cost !== "number" || !Number.isFinite(body.cost) || body.cost < 0 || body.cost > MAX_PRICE)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "cost debe ser un número finito >= 0"), 400);
  }
  if (
    body.tax_rate !== undefined &&
    body.tax_rate !== null &&
    (typeof body.tax_rate !== "number" || !Number.isFinite(body.tax_rate) || body.tax_rate < 0 || body.tax_rate > MAX_TAX_RATE)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "tax_rate debe estar entre 0 y 100"), 400);
  }
  if (
    body.min_stock !== undefined &&
    body.min_stock !== null &&
    (typeof body.min_stock !== "number" || !Number.isFinite(body.min_stock) || body.min_stock < 0 || body.min_stock > MAX_STOCK_BOUND)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "min_stock debe ser un número finito >= 0"), 400);
  }
  if (
    body.max_stock !== undefined &&
    body.max_stock !== null &&
    (typeof body.max_stock !== "number" || !Number.isFinite(body.max_stock) || body.max_stock < 0 || body.max_stock > MAX_STOCK_BOUND)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "max_stock debe ser un número finito >= 0"), 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  let categoryId = body.category_id ?? null;
  if (!categoryId) {
    const cat = await db
      .prepare("SELECT id FROM categories WHERE branch_id = ? LIMIT 1")
      .bind(branchId)
      .first<{ id: string }>();
    categoryId = cat?.id ?? null;
  }

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();

  await db
    .prepare(
      `INSERT INTO products (id, code, name, description, barcode, category_id, branch_id, unit, price, cost, tax_rate, min_stock, max_stock, is_raw_material, is_producible, track_inventory, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .bind(
      id,
      body.code.trim(),
      body.name.trim(),
      body.description ?? null,
      body.barcode ?? null,
      categoryId,
      branchId,
      body.unit ?? null,
      body.price,
      body.cost ?? null,
      body.tax_rate ?? 0,
      body.min_stock ?? null,
      body.max_stock ?? null,
      body.is_raw_material ? 1 : 0,
      body.is_producible ? 1 : 0,
      now,
      now,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id
productRoutes.put("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageProducts(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar productos"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    code?: string;
    name?: string;
    description?: string;
    barcode?: string;
    category_id?: string;
    unit?: string;
    price?: number;
    cost?: number;
    tax_rate?: number;
    min_stock?: number;
    max_stock?: number;
    is_raw_material?: boolean;
    is_producible?: boolean;
    is_active?: boolean;
  }>();

  const existing = await db
    .prepare("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return c.json(errBody("NOT_FOUND", "Producto no encontrado"), 404);
  }

  // SECURITY: re-validate numeric fields on update so a client cannot
  // poison existing rows with NaN/Infinity/negative values.
  if (
    body.price !== undefined &&
    body.price !== null &&
    (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0 || body.price > MAX_PRICE)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "price debe ser un número finito >= 0"), 400);
  }
  if (
    body.cost !== undefined &&
    body.cost !== null &&
    (typeof body.cost !== "number" || !Number.isFinite(body.cost) || body.cost < 0 || body.cost > MAX_PRICE)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "cost debe ser un número finito >= 0"), 400);
  }
  if (
    body.tax_rate !== undefined &&
    body.tax_rate !== null &&
    (typeof body.tax_rate !== "number" || !Number.isFinite(body.tax_rate) || body.tax_rate < 0 || body.tax_rate > MAX_TAX_RATE)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "tax_rate debe estar entre 0 y 100"), 400);
  }
  if (
    body.min_stock !== undefined &&
    body.min_stock !== null &&
    (typeof body.min_stock !== "number" || !Number.isFinite(body.min_stock) || body.min_stock < 0 || body.min_stock > MAX_STOCK_BOUND)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "min_stock debe ser un número finito >= 0"), 400);
  }
  if (
    body.max_stock !== undefined &&
    body.max_stock !== null &&
    (typeof body.max_stock !== "number" || !Number.isFinite(body.max_stock) || body.max_stock < 0 || body.max_stock > MAX_STOCK_BOUND)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "max_stock debe ser un número finito >= 0"), 400);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  const setClauses: string[] = [];
  const values: (string | number | boolean | null)[] = [];

  for (const field of ["code", "name", "description", "barcode", "category_id", "unit"] as const) {
    if (field in body) { setClauses.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  for (const field of ["price", "cost", "tax_rate", "min_stock", "max_stock"] as const) {
    if (field in body) { setClauses.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  for (const field of ["is_raw_material", "is_producible", "is_active"] as const) {
    if (field in body) {
      setClauses.push(`${field} = ?`);
      values.push(body[field] == null ? null : body[field] ? 1 : 0);
    }
  }

  if (setClauses.length === 0) {
    return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);
  }

  setClauses.push("updated_at = ?");
  values.push(now, id);

  await db
    .prepare(`UPDATE products SET ${setClauses.join(", ")} WHERE id = ? AND deleted_at IS NULL`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { id } });
});

// DELETE /:id — soft delete
productRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: only admin/owner can delete products to prevent supervisors
  // from cascading deletes of catalog entries.
  const role = c.get("userRole");
  if (role !== "admin" && role !== "owner") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para eliminar productos"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return c.json(errBody("NOT_FOUND", "Producto no encontrado"), 404);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      "UPDATE products SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?",
    )
    .bind(now, now, id)
    .run();

  return c.json({ success: true, data: { id } });
});

// GET /:id/prices
productRoutes.get("/:id/prices", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const product = await db.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!product) return c.json(errBody("NOT_FOUND", "Producto no encontrado"), 404);

  const results = await db
    .prepare(
      `SELECT pp.*, b.name AS branch_name
       FROM product_prices pp
       LEFT JOIN branches b ON b.id = pp.branch_id
       WHERE pp.product_id = ? AND pp.is_active = 1
       ORDER BY pp.price_list_type, pp.created_at DESC`,
    )
    .bind(id)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// POST /:id/prices
productRoutes.post("/:id/prices", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageProducts(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para gestionar precios"), 403);
  }

  const db = c.env.DB;
  const productId = c.req.param("id");
  const body = await c.req.json<{
    price_list_type: "retail" | "wholesale" | "promotional";
    price: number;
    branch_id?: string;
    start_date?: string;
    end_date?: string;
  }>();

  const validTypes = new Set(["retail", "wholesale", "promotional"]);
  if (!body.price_list_type || !validTypes.has(body.price_list_type)) {
    return c.json(
      errBody("VALIDATION_ERROR", "price_list_type debe ser uno de: retail, wholesale, promotional"),
      400,
    );
  }
  if (
    typeof body.price !== "number" ||
    !Number.isFinite(body.price) ||
    body.price <= 0 ||
    body.price > MAX_PRICE
  ) {
    return c.json(errBody("VALIDATION_ERROR", "price debe ser un número finito > 0"), 400);
  }

  const productExists = await db
    .prepare("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(productId)
    .first<{ id: string }>();
  if (!productExists) return c.json(errBody("NOT_FOUND", "Producto no encontrado"), 404);

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db.prepare(
    'UPDATE product_prices SET is_active = 0 WHERE product_id = ? AND price_list_type = ? AND is_active = 1',
  ).bind(productId, body.price_list_type).run();

  await db
    .prepare(
      `INSERT INTO product_prices
        (id, product_id, branch_id, price_list_type, price, start_date, end_date, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      productId,
      branchId,
      body.price_list_type,
      body.price,
      body.start_date ?? null,
      body.end_date ?? null,
      now,
      now,
    )
    .run();

  const created = await db
    .prepare("SELECT * FROM product_prices WHERE id = ? LIMIT 1")
    .bind(id)
    .first();

  return c.json({ success: true, data: created }, 201);
});
