import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";

export const batchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
// SECURITY: cap monetary and quantity inputs.
const MAX_QUANTITY = 1_000_000;
const MAX_UNIT_COST = 10_000_000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

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
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
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
      return c.json(errBody("VALIDATION_ERROR", "expiring_within_hours debe ser un número no-negativo"), 400);
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
       WHERE ib.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<BatchRow>();

  if (!row) return c.json(errBody("NOT_FOUND", "Lote no encontrado"), 404);
  return c.json({ success: true, data: row });
});

batchRoutes.post("/", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: only privileged roles can mint inventory_batches. A cashier
  // creating a batch is equivalent to manufacturing inventory out of nothing.
  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse" &&
    userRole !== "production"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear lotes"), 403);
  }

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

  if (!body.product_id) return c.json(errBody("VALIDATION_ERROR", "product_id es requerido"), 400);
  if (!body.batch_number) return c.json(errBody("VALIDATION_ERROR", "batch_number es requerido"), 400);
  if (!body.entry_date) return c.json(errBody("VALIDATION_ERROR", "entry_date es requerido"), 400);
  if (!isValidDate(body.entry_date)) {
    return c.json(errBody("VALIDATION_ERROR", "entry_date debe ser una fecha válida YYYY-MM-DD"), 400);
  }
  if (body.expiry_date !== undefined && !isValidDate(body.expiry_date)) {
    return c.json(errBody("VALIDATION_ERROR", "expiry_date debe ser una fecha válida YYYY-MM-DD"), 400);
  }
  if (
    typeof body.cost_per_unit !== "number" ||
    !Number.isFinite(body.cost_per_unit) ||
    body.cost_per_unit < 0 ||
    body.cost_per_unit > MAX_UNIT_COST
  ) {
    return c.json(errBody("VALIDATION_ERROR", "cost_per_unit debe ser un número finito >= 0"), 400);
  }
  if (
    typeof body.initial_quantity !== "number" ||
    !Number.isFinite(body.initial_quantity) ||
    body.initial_quantity <= 0 ||
    body.initial_quantity > MAX_QUANTITY
  ) {
    return c.json(errBody("VALIDATION_ERROR", "initial_quantity debe ser un número finito > 0"), 400);
  }
  if (
    body.remaining_quantity !== undefined &&
    (typeof body.remaining_quantity !== "number" ||
      !Number.isFinite(body.remaining_quantity) ||
      body.remaining_quantity < 0 ||
      body.remaining_quantity > body.initial_quantity)
  ) {
    return c.json(
      errBody("VALIDATION_ERROR", "remaining_quantity debe ser un número finito entre 0 e initial_quantity"),
      400,
    );
  }

  const inventoryMethod = body.inventory_method ?? "FIFO";
  if (!VALID_INVENTORY_METHODS.has(inventoryMethod)) {
    return c.json(errBody("VALIDATION_ERROR", "inventory_method debe ser FIFO o LIFO"), 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const id = genId();
  const remaining = body.remaining_quantity ?? body.initial_quantity;

  await db
    .prepare(
      `INSERT INTO inventory_batches
        (id, product_id, branch_id, batch_number, entry_date, expiry_date, durability_days,
         cost_per_unit, initial_quantity, remaining_quantity, inventory_method, status,
         supplier_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
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
      body.notes ?? null,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

batchRoutes.put("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse" &&
    userRole !== "production"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar lotes"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM inventory_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Lote no encontrado"), 404);

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
    if (
      typeof body.remaining_quantity !== "number" ||
      !Number.isFinite(body.remaining_quantity) ||
      body.remaining_quantity < 0 ||
      body.remaining_quantity > MAX_QUANTITY
    ) {
      return c.json(errBody("VALIDATION_ERROR", "remaining_quantity debe ser un número finito no-negativo"), 400);
    }
    setClauses.push("remaining_quantity = ?");
    values.push(body.remaining_quantity);
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return c.json(errBody("VALIDATION_ERROR", `status debe ser uno de: ${[...VALID_STATUSES].join(", ")}`), 400);
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
      return c.json(errBody("VALIDATION_ERROR", "expiry_date debe ser una fecha válida YYYY-MM-DD"), 400);
    }
    setClauses.push("expiry_date = ?");
    values.push(body.expiry_date);
  }

  if (setClauses.length === 0) {
    return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);
  }

  values.push(id);
  await db
    .prepare(`UPDATE inventory_batches SET ${setClauses.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { id } });
});

// POST /expire-stale
// FIX A3: marca como 'expired' todos los lotes activos cuya expiry_date ya pasó
// según hora argentina (UTC-3). Pensado para ser disparado por el cron schedule
// del Worker o manualmente por un admin. Devuelve la cantidad de lotes
// actualizados para que el frontend pueda mostrar un toast.
batchRoutes.post("/expire-stale", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para expirar lotes"), 403);
  }

  const db = c.env.DB;
  const result = await db
    .prepare(
      `UPDATE inventory_batches
         SET status = 'expired'
       WHERE status = 'active'
         AND expiry_date IS NOT NULL
         AND expiry_date < DATE('now', '-3 hours')`,
    )
    .run();

  return c.json({ success: true, data: { expired: result.meta.changes ?? 0 } });
});

batchRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para retirar lotes"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ withdrawal_reason?: string }>().catch((): { withdrawal_reason?: string } => ({}));

  const existing = await db
    .prepare("SELECT id FROM inventory_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Lote no encontrado"), 404);

  await db
    .prepare(
      `UPDATE inventory_batches SET status = 'withdrawn', withdrawal_reason = ? WHERE id = ?`,
    )
    .bind(body.withdrawal_reason ?? null, id)
    .run();

  return c.json({ success: true, data: { id } });
});
