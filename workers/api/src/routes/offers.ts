import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const offerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";
const VALID_STATUSES = new Set(["active", "expired", "cancelled"]);

interface OfferRow {
  id: string;
  branch_id: string;
  user_id: string;
  name: string;
  discount_percent: number;
  batch_ids: string;
  product_ids: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string;
}

offerRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const status = c.req.query("status");

  let query = `SELECT o.*, u.name AS created_by_name
               FROM offers o
               LEFT JOIN users u ON u.id = o.user_id
               WHERE o.branch_id = ?`;
  const bindings: (string | number)[] = [branchId];

  if (status) {
    query += " AND o.status = ?";
    bindings.push(status);
  }

  query += " ORDER BY o.created_at DESC";

  const results = await db.prepare(query).bind(...bindings).all<OfferRow>();
  return c.json({ success: true, data: results.results ?? [] });
});

offerRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare(
      `SELECT o.*, u.name AS created_by_name
       FROM offers o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = ? LIMIT 1`
    )
    .bind(id)
    .first<OfferRow>();

  if (!row) return c.json({ success: false, error: "Offer not found" }, 404);
  return c.json({ success: true, data: row });
});

offerRoutes.post("/", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const body = await c.req.json<{
    branch_id?: string;
    name: string;
    discount_percent: number;
    batch_ids: string[];
    product_ids: string[];
    starts_at?: string;
    ends_at?: string;
    notes?: string;
  }>();

  if (!body.name?.trim()) return c.json({ success: false, error: "name is required" }, 400);
  if (
    typeof body.discount_percent !== "number" ||
    body.discount_percent <= 0 ||
    body.discount_percent > 100
  ) {
    return c.json(
      { success: false, error: "discount_percent must be between 0 (exclusive) and 100" },
      400
    );
  }
  if (!Array.isArray(body.batch_ids)) {
    return c.json({ success: false, error: "batch_ids must be an array" }, 400);
  }
  if (!Array.isArray(body.product_ids)) {
    return c.json({ success: false, error: "product_ids must be an array" }, 400);
  }
  if (body.batch_ids.length === 0 && body.product_ids.length === 0) {
    return c.json({ success: false, error: 'At least one batch_id or product_id is required' }, 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const startsAt = body.starts_at ?? now;

  await db
    .prepare(
      `INSERT INTO offers
        (id, branch_id, user_id, name, discount_percent, batch_ids, product_ids,
         starts_at, ends_at, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .bind(
      id,
      branchId,
      user.id,
      body.name.trim(),
      body.discount_percent,
      JSON.stringify(body.batch_ids),
      JSON.stringify(body.product_ids),
      startsAt,
      body.ends_at ?? null,
      body.notes ?? null,
      now,
      now
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

offerRoutes.put("/:id/status", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ status: string }>();

  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return c.json(
      { success: false, error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` },
      400
    );
  }

  const existing = await db
    .prepare("SELECT id FROM offers WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Offer not found" }, 404);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE offers SET status = ?, updated_at = ? WHERE id = ?")
    .bind(body.status, now, id)
    .run();

  return c.json({ success: true, data: { id, status: body.status } });
});

offerRoutes.delete("/:id", async (c) => {
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM offers WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Offer not found" }, 404);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE offers SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return c.json({ success: true, data: { id } });
});
