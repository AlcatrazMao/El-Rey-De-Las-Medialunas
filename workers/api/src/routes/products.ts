import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const productRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// GET /
productRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const limit = parseInt(c.req.query("limit") ?? "200", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const search = c.req.query("search");

  let query =
    "SELECT * FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  let countQuery =
    "SELECT COUNT(*) as total FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  const bindings: (string | number)[] = [branchId];
  const countBindings: (string | number)[] = [branchId];

  if (search) {
    const like = `%${search}%`;
    query += " AND (name LIKE ? OR code LIKE ?)";
    countQuery += " AND (name LIKE ? OR code LIKE ?)";
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
  const limit = parseInt(c.req.query("limit") ?? "200", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const q = c.req.query("q");

  let query =
    "SELECT * FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  let countQuery =
    "SELECT COUNT(*) as total FROM products WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1";
  const bindings: (string | number)[] = [branchId];
  const countBindings: (string | number)[] = [branchId];

  if (q) {
    const like = `%${q}%`;
    query += " AND (name LIKE ? OR code LIKE ?)";
    countQuery += " AND (name LIKE ? OR code LIKE ?)";
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
      "SELECT * FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1"
    )
    .bind(id)
    .first();

  if (!product) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }

  return c.json({ success: true, data: product });
});

// POST /
productRoutes.post("/", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
    )
    .bind(
      id,
      body.code,
      body.name,
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
      now
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id
productRoutes.put("/:id", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

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
    return c.json({ success: false, error: "Product not found" }, 404);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `UPDATE products SET
         code         = COALESCE(?, code),
         name         = COALESCE(?, name),
         description  = COALESCE(?, description),
         barcode      = COALESCE(?, barcode),
         category_id  = COALESCE(?, category_id),
         unit         = COALESCE(?, unit),
         price        = COALESCE(?, price),
         cost         = COALESCE(?, cost),
         tax_rate     = COALESCE(?, tax_rate),
         min_stock    = COALESCE(?, min_stock),
         max_stock    = COALESCE(?, max_stock),
         is_raw_material = COALESCE(?, is_raw_material),
         is_producible   = COALESCE(?, is_producible),
         is_active       = COALESCE(?, is_active),
         updated_at   = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(
      body.code ?? null,
      body.name ?? null,
      body.description ?? null,
      body.barcode ?? null,
      body.category_id ?? null,
      body.unit ?? null,
      body.price ?? null,
      body.cost ?? null,
      body.tax_rate ?? null,
      body.min_stock ?? null,
      body.max_stock ?? null,
      body.is_raw_material !== undefined ? (body.is_raw_material ? 1 : 0) : null,
      body.is_producible !== undefined ? (body.is_producible ? 1 : 0) : null,
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : null,
      now,
      id
    )
    .run();

  return c.json({ success: true, data: { id } });
});

// DELETE /:id — soft delete
productRoutes.delete("/:id", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      "UPDATE products SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?"
    )
    .bind(now, now, id)
    .run();

  return c.json({ success: true, data: { id } });
});

// GET /:id/prices — stub preserved
productRoutes.get("/:id/prices", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Product prices endpoint",
  });
});

// POST /:id/prices — stub preserved
productRoutes.post("/:id/prices", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create product price endpoint",
    },
  }, 201);
});
