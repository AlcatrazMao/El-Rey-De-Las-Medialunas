import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const supplyRequestRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// GET /
supplyRequestRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const status = c.req.query("status");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  let query =
    "SELECT * FROM supply_requests WHERE branch_id = ?";
  const bindings: (string | number)[] = [branchId];

  if (status) {
    query += " AND status = ?";
    bindings.push(status);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db
    .prepare(query)
    .bind(...bindings)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /:id
supplyRequestRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare("SELECT * FROM supply_requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first();

  if (!row) {
    return c.json({ success: false, error: "Supply request not found" }, 404);
  }

  return c.json({ success: true, data: row });
});

// POST /
supplyRequestRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    id?: string;
    type: string;
    item_id: string;
    item_name: string;
    quantity: number;
    unit: string;
    reason?: string;
    requested_by: string;
    branch_id?: string;
  }>();

  if (!body.type || !body.item_id || !body.item_name || !body.unit || !body.requested_by) {
    return c.json(
      { success: false, error: "type, item_id, item_name, quantity, unit, and requested_by are required" },
      400
    );
  }
  if (body.quantity === undefined || body.quantity === null || body.quantity < 0) {
    return c.json({ success: false, error: 'quantity es requerido y debe ser >= 0' }, 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);
  const userId = user.id;

  const id = body.id ?? crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT OR IGNORE INTO supply_requests
         (id, branch_id, user_id, type, item_id, item_name, quantity, unit, reason, requested_by, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(
      id,
      branchId,
      userId,
      body.type,
      body.item_id,
      body.item_name,
      body.quantity,
      body.unit,
      body.reason ?? null,
      body.requested_by,
      now,
      now
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id
supplyRequestRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    status: "approved" | "rejected";
    admin_memo?: string;
  }>();

  if (!body.status || !["approved", "rejected"].includes(body.status)) {
    return c.json(
      { success: false, error: "status must be 'approved' or 'rejected'" },
      400
    );
  }

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const existing = await db
    .prepare("SELECT id FROM supply_requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ success: false, error: "Supply request not found" }, 404);
  }

  const updatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `UPDATE supply_requests SET status = ?, admin_memo = ?, updated_at = ? WHERE id = ?`
    )
    .bind(body.status, body.admin_memo ?? null, updatedAt, id)
    .run();

  return c.json({ success: true, data: { id, status: body.status, updated_at: updatedAt } });
});
