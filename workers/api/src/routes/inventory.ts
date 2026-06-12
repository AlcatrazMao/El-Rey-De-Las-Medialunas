import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const inventoryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";
const FALLBACK_USER = "00000000000000000000000000000001";

const VALID_MOVEMENT_TYPES = new Set([
  "purchase_in",
  "production_in",
  "transfer_in",
  "adjustment_in",
  "return_in",
  "sale_out",
  "transfer_out",
  "waste_out",
  "adjustment_out",
  "production_out",
]);

async function resolveUser(
  db: D1Database,
  authHeader: string | null
): Promise<{ id: string } | null> {
  if (!authHeader) return null;
  try {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const parts = token.split(".");
    const encodedPayload = parts[1];
    if (parts.length < 2 || !encodedPayload) return null;
    const payload = JSON.parse(
      atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    const firebaseUid: string | undefined =
      payload.user_id ?? payload.uid ?? payload.sub;
    if (!firebaseUid) return null;
    const row = await db
      .prepare(
        "SELECT id FROM users WHERE firebase_uid = ? AND is_active = 1 LIMIT 1"
      )
      .bind(firebaseUid)
      .first<{ id: string }>();
    return row ?? null;
  } catch {
    return null;
  }
}

// GET /
inventoryRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const limit = parseInt(c.req.query("limit") ?? "200", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const results = await db
    .prepare(
      `SELECT i.*, p.name as product_name, p.unit, p.min_stock as product_min_stock
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       WHERE i.branch_id = ?
       LIMIT ? OFFSET ?`
    )
    .bind(branchId, limit, offset)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /low-stock
inventoryRoutes.get("/low-stock", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;

  const results = await db
    .prepare(
      `SELECT i.*, p.name as product_name, p.unit, p.min_stock as product_min_stock
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       WHERE i.current_quantity <= i.min_stock AND i.branch_id = ?`
    )
    .bind(branchId)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /movements
inventoryRoutes.get("/movements", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const productId = c.req.query("product_id");
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  let query =
    "SELECT * FROM stock_movements WHERE branch_id = ?";
  const bindings: (string | number)[] = [branchId];

  if (productId) {
    query += " AND product_id = ?";
    bindings.push(productId);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db
    .prepare(query)
    .bind(...bindings)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// POST /adjust
inventoryRoutes.post("/adjust", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    product_id: string;
    branch_id?: string;
    movement_type: string;
    quantity: number;
    reason?: string;
    notes?: string;
    unit_cost_at_time?: number;
  }>();

  if (!body.product_id) {
    return c.json({ success: false, error: "product_id is required" }, 400);
  }
  if (!body.movement_type || !VALID_MOVEMENT_TYPES.has(body.movement_type)) {
    return c.json(
      {
        success: false,
        error: `movement_type must be one of: ${[...VALID_MOVEMENT_TYPES].join(", ")}`,
      },
      400
    );
  }
  if (body.quantity === undefined || body.quantity === null) {
    return c.json({ success: false, error: "quantity is required" }, 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const user = await resolveUser(db, c.req.header("Authorization") ?? null);
  const userId = user?.id ?? FALLBACK_USER;

  const movementId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT INTO stock_movements
         (id, product_id, branch_id, movement_type, quantity, unit_cost_at_time, reason, user_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      movementId,
      body.product_id,
      branchId,
      body.movement_type,
      body.quantity,
      body.unit_cost_at_time ?? null,
      body.reason ?? null,
      userId,
      body.notes ?? null,
      createdAt
    )
    .run();

  const delta = body.movement_type.endsWith("_in")
    ? body.quantity
    : -body.quantity;

  const updated = await db
    .prepare(
      `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
       WHERE product_id = ? AND branch_id = ?`
    )
    .bind(delta, createdAt, body.product_id, branchId)
    .run();

  if ((updated.meta?.changes ?? 0) === 0) {
    const invId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    await db
      .prepare(
        `INSERT INTO inventory (id, product_id, branch_id, current_quantity, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(invId, body.product_id, branchId, delta, createdAt)
      .run();
  }

  return c.json({ success: true, data: { id: movementId } }, 201);
});
