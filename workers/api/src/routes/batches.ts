import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const batchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

const VALID_STATUSES = new Set(["active", "withdrawn", "sold_out", "expired"]);
const VALID_INVENTORY_METHODS = new Set(["FIFO", "LIFO"]);

interface BatchRow {
  id: string;
  product_id: string;
  branch_id: string;
  batch_number: string;
  entry_date: string;
  expiry_date: string | null;
  durability_days: number | null;
  cost_per_unit: number;
  initial_quantity: number;
  remaining_quantity: number;
  inventory_method: string;
  status: string;
  withdrawal_reason: string | null;
  supplier_id: string | null;
  purchase_order_id: string | null;
  production_batch_id: string | null;
  notes: string | null;
  created_at: string;
  product_name?: string;
  product_code?: string;
}

batchRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const productId = c.req.query("product_id");
  const status = c.req.query("status") ?? "active";
  const expiringWithinHoursRaw = c.req.query("expiring_within_hours");

  let query = `SELECT ib.*, p.name AS product_name, p.code AS product_code
               FROM inventory_batches ib
               LEFT JOIN products p ON p.id = ib.product_id
               WHERE ib.branch_id = ? AND ib.status = ?`;
  const bindings: (string | number)[] = [branchId, status];

  if (productId) {
    query += " AND ib.product_id = ?";
    bindings.push(productId);
  }

  if (expiringWithinHoursRaw) {
    const hours = Number(expiringWithinHoursRaw);
    if (!Number.isFinite(hours) || hours < 0) {
      return c.json({ success: false, error: "expiring_within_hours must be a non-negative number" }, 400);
    }
    const limitDate = new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 10);
    query += " AND ib.expiry_date IS NOT NULL AND ib.expiry_date >= date('now') AND ib.expiry_date <= ?";
    bindings.push(limitDate);
  }

  query += " ORDER BY (ib.expiry_date IS NULL), ib.expiry_date ASC, ib.entry_date ASC";

  const results = await db.prepare(query).bind(...bindings).all<BatchRow>();
  return c.json({ success: true, data: results.results ?? [] });
});

batchRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare(
      `SELECT ib.*, p.name AS product_name, p.code AS product_code
       FROM inventory_batches ib
       LEFT JOIN products p ON p.id = ib.product_id
       WHERE ib.id = ? LIMIT 1`
    )
    .bind(id)
    .first<BatchRow>();

  if (!row) return c.json({ success: false, error: "Batch not found" }, 404);
  return c.json({ success: true, data: row });
});

batchRoutes.post("/", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const body = await c.req.json<{
    product_id: string;
    branch_id?: string;
    batch_number: string;
    entry_date: string;
    expiry_date?: string;
    durability_days?: number;
    cost_per_unit: number;
    initial_quantity: number;
    remaining_quantity?: number;
    inventory_method?: string;
    supplier_id?: string;
    notes?: string;
  }>();

  if (!body.product_id) return c.json({ success: false, error: "product_id is required" }, 400);
  if (!body.batch_number) return c.json({ success: false, error: "batch_number is required" }, 400);
  if (!body.entry_date) return c.json({ success: false, error: "entry_date is required" }, 400);
  if (!isValidDate(body.entry_date)) {
    return c.json({ success: false, error: "entry_date must be a valid date in YYYY-MM-DD format" }, 400);
  }
  if (body.expiry_date !== undefined && !isValidDate(body.expiry_date)) {
    return c.json({ success: false, error: "expiry_date must be a valid date in YYYY-MM-DD format" }, 400);
  }
  if (typeof body.cost_per_unit !== "number" || body.cost_per_unit < 0) {
    return c.json({ success: false, error: "cost_per_unit must be a non-negative number" }, 400);
  }
  if (typeof body.initial_quantity !== "number" || body.initial_quantity <= 0) {
    return c.json({ success: false, error: "initial_quantity must be a positive number" }, 400);
  }

  const inventoryMethod = body.inventory_method ?? "FIFO";
  if (!VALID_INVENTORY_METHODS.has(inventoryMethod)) {
    return c.json({ success: false, error: "inventory_method must be FIFO or LIFO" }, 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const remaining = body.remaining_quantity ?? body.initial_quantity;

  await db
    .prepare(
      `INSERT INTO inventory_batches
        (id, product_id, branch_id, batch_number, entry_date, expiry_date, durability_days,
         cost_per_unit, initial_quantity, remaining_quantity, inventory_method, status,
         supplier_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(
      id,
      body.product_id,
      branchId,
      body.batch_number,
      body.entry_date,
      body.expiry_date ?? null,
      body.durability_days ?? null,
      body.cost_per_unit,
      body.initial_quantity,
      remaining,
      inventoryMethod,
      body.supplier_id ?? null,
      body.notes ?? null
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

batchRoutes.put("/:id", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM inventory_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Batch not found" }, 404);

  const body = await c.req.json<{
    remaining_quantity?: number;
    status?: string;
    withdrawal_reason?: string;
    notes?: string;
    expiry_date?: string;
  }>();

  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.remaining_quantity !== undefined) {
    if (typeof body.remaining_quantity !== "number" || body.remaining_quantity < 0) {
      return c.json({ success: false, error: "remaining_quantity must be a non-negative number" }, 400);
    }
    setClauses.push("remaining_quantity = ?");
    values.push(body.remaining_quantity);
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return c.json({ success: false, error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
    }
    setClauses.push("status = ?");
    values.push(body.status);
  }

  if (body.withdrawal_reason !== undefined) {
    setClauses.push("withdrawal_reason = ?");
    values.push(body.withdrawal_reason);
  }

  if (body.notes !== undefined) {
    setClauses.push("notes = ?");
    values.push(body.notes);
  }

  if (body.expiry_date !== undefined) {
    if (!isValidDate(body.expiry_date)) {
      return c.json({ success: false, error: "expiry_date must be a valid date in YYYY-MM-DD format" }, 400);
    }
    setClauses.push("expiry_date = ?");
    values.push(body.expiry_date);
  }

  if (setClauses.length === 0) {
    return c.json({ success: false, error: "No fields to update" }, 400);
  }

  values.push(id);
  await db
    .prepare(`UPDATE inventory_batches SET ${setClauses.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { id } });
});

batchRoutes.delete("/:id", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ withdrawal_reason?: string }>().catch(() => ({}));

  const existing = await db
    .prepare("SELECT id FROM inventory_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Batch not found" }, 404);

  await db
    .prepare(
      `UPDATE inventory_batches SET status = 'withdrawn', withdrawal_reason = ? WHERE id = ?`
    )
    .bind(body.withdrawal_reason ?? null, id)
    .run();

  return c.json({ success: true, data: { id } });
});
