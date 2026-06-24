import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const inventoryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  "production_waste",
]);

// GET /
inventoryRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 500);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

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
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;

  const results = await db
    .prepare(
      `SELECT i.*, p.name as product_name, p.unit, p.min_stock as product_min_stock
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       WHERE i.current_quantity <= i.min_stock AND i.branch_id = ?
       LIMIT 100`
    )
    .bind(branchId)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /movements
inventoryRoutes.get("/movements", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const productId = c.req.query("product_id");
  const rawLimitMov = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffsetMov = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimitMov) ? 50 : rawLimitMov, 1), 500);
  const offset = Math.max(isNaN(rawOffsetMov) ? 0 : rawOffsetMov, 0);

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
    idempotency_key?: string;
  }>();

  if (!body.product_id) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "product_id es requerido" } }, 400);
  }
  if (!body.movement_type || !VALID_MOVEMENT_TYPES.has(body.movement_type)) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: `movement_type debe ser uno de: ${[...VALID_MOVEMENT_TYPES].join(", ")}` },
      },
      400,
    );
  }
  if (typeof body.quantity !== 'number' || body.quantity <= 0 || !isFinite(body.quantity) || body.quantity > 1_000_000) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "quantity debe ser un número finito > 0" } }, 400);
  }
  if (
    body.unit_cost_at_time !== undefined &&
    body.unit_cost_at_time !== null &&
    (typeof body.unit_cost_at_time !== 'number' ||
      !Number.isFinite(body.unit_cost_at_time) ||
      body.unit_cost_at_time < 0 ||
      body.unit_cost_at_time > 10_000_000)
  ) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "unit_cost_at_time debe ser un número finito >= 0" } }, 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  // SECURITY: stock adjustment is a privileged operation — cashiers must not
  // be allowed to mint or burn inventory.
  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse" &&
    userRole !== "production"
  ) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ajustar inventario" } },
      403,
    );
  }

  // Idempotency: si viene idempotency_key, verificar si ya fue procesado.
  const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.trim() !== ""
    ? body.idempotency_key.trim()
    : null;

  if (idempotencyKey) {
    const existing = await db
      .prepare("SELECT id FROM stock_movements WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first<{ id: string }>();
    if (existing) {
      return c.json({ success: true, data: { id: existing.id }, idempotent_replay: true }, 200);
    }
  }

  const movementId = genId();
  const createdAt = nowSqliteTs();

  const isInbound = body.movement_type.endsWith("_in");
  const delta = isInbound ? body.quantity : -body.quantity;

  // Fix R7-3 — ALTO: para movimientos _out rechazar explícitamente si el stock
  // es insuficiente en lugar de clampear silenciosamente a 0.
  if (!isInbound) {
    const current = await db
      .prepare("SELECT current_quantity FROM inventory WHERE product_id = ? AND branch_id = ?")
      .bind(body.product_id, branchId)
      .first<{ current_quantity: number }>();
    if ((current?.current_quantity ?? 0) + delta < 0) {
      return c.json(
        { success: false, error: { code: "INSUFFICIENT_STOCK", message: "El ajuste supera el stock disponible" } },
        409,
      );
    }
  }

  const invId = genId();
  // Para movimientos _out clampeamos a 0 como defensa adicional — dado que ya
  // rechazamos el caso insuficiente arriba, este MAX(0, ...) es solo una guardia
  // de seguridad ante condiciones de carrera extremas. Para _in suma directa.
  const updateSql = isInbound
    ? `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
       WHERE product_id = ? AND branch_id = ?`
    : `UPDATE inventory SET current_quantity = MAX(0, current_quantity + ?), updated_at = ?
       WHERE product_id = ? AND branch_id = ?`;

  // Atomic batch: INSERT stock_movement + INSERT OR IGNORE inventory row + UPDATE inventory.
  // Si cualquier statement falla, D1 revierte todo — no queda movement sin stock actualizado.
  await db.batch([
    db
      .prepare(
        `INSERT INTO stock_movements
           (id, product_id, branch_id, movement_type, quantity, unit_cost_at_time, reason, user_id, notes, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        idempotencyKey,
        createdAt
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO inventory (id, product_id, branch_id, current_quantity, updated_at)
         VALUES (?, ?, ?, 0, ?)`
      )
      .bind(invId, body.product_id, branchId, createdAt),
    db
      .prepare(updateSql)
      .bind(delta, createdAt, body.product_id, branchId),
  ]);

  return c.json({ success: true, data: { id: movementId } }, 201);
});
