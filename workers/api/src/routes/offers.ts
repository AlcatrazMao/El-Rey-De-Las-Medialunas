import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const offerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const VALID_STATUSES = new Set(["active", "expired", "cancelled"]);
const MAX_IDS_PER_OFFER = 1000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

function canManageOffers(role: string | undefined): boolean {
  return role === "admin" || role === "owner" || role === "supervisor";
}

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
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const status = c.req.query("status");
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 100);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);

  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return c.json(
      errBody("VALIDATION_ERROR", `status debe ser uno de: ${[...VALID_STATUSES].join(", ")}`),
      400,
    );
  }

  let query = `SELECT o.*, u.name AS created_by_name
               FROM offers o
               LEFT JOIN users u ON u.id = o.user_id
               WHERE o.branch_id = ?`;
  const bindings: (string | number)[] = [branchId];

  if (status) {
    query += " AND o.status = ?";
    bindings.push(status);
  }

  query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db.prepare(query).bind(...bindings).all<OfferRow>();
  return c.json({ success: true, data: results.results ?? [], pagination: { limit, offset } });
});

offerRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare(
      `SELECT o.*, u.name AS created_by_name
       FROM offers o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<OfferRow>();

  if (!row) return c.json(errBody("NOT_FOUND", "Oferta no encontrada"), 404);
  return c.json({ success: true, data: row });
});

offerRoutes.post("/", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: offers grant discounts — only privileged roles can create them.
  // A cashier creating arbitrary offers could effectively give away inventory.
  if (!canManageOffers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear ofertas"), 403);
  }

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

  if (!body.name?.trim()) return c.json(errBody("VALIDATION_ERROR", "name es requerido"), 400);
  if (
    typeof body.discount_percent !== "number" ||
    !Number.isFinite(body.discount_percent) ||
    body.discount_percent <= 0 ||
    body.discount_percent > 100
  ) {
    return c.json(
      errBody("VALIDATION_ERROR", "discount_percent debe ser un número finito entre 0 (exclusive) y 100"),
      400,
    );
  }
  if (!Array.isArray(body.batch_ids)) {
    return c.json(errBody("VALIDATION_ERROR", "batch_ids debe ser un array"), 400);
  }
  if (!Array.isArray(body.product_ids)) {
    return c.json(errBody("VALIDATION_ERROR", "product_ids debe ser un array"), 400);
  }
  if (body.batch_ids.length === 0 && body.product_ids.length === 0) {
    return c.json(errBody("VALIDATION_ERROR", "Se requiere al menos un batch_id o product_id"), 400);
  }
  // SECURITY: cap array lengths to avoid bloating the offers row with a
  // JSON blob of arbitrary size.
  if (body.batch_ids.length > MAX_IDS_PER_OFFER || body.product_ids.length > MAX_IDS_PER_OFFER) {
    return c.json(errBody("VALIDATION_ERROR", `Demasiados ids en la oferta (máx ${MAX_IDS_PER_OFFER})`), 400);
  }
  // Validate every id is a string to avoid persisting weird values inside the JSON blob.
  for (const arr of [body.batch_ids, body.product_ids]) {
    for (const id of arr) {
      if (typeof id !== 'string' || !id.trim()) {
        return c.json(errBody("VALIDATION_ERROR", "Todos los ids deben ser strings no vacíos"), 400);
      }
    }
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const id = genId();
  const now = nowSqliteTs();
  const startsAt = body.starts_at ?? now;

  await db
    .prepare(
      `INSERT INTO offers
        (id, branch_id, user_id, name, discount_percent, batch_ids, product_ids,
         starts_at, ends_at, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
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
      now,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

offerRoutes.put("/:id/status", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageOffers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar ofertas"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ status: string }>();

  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return c.json(
      errBody("VALIDATION_ERROR", `status debe ser uno de: ${[...VALID_STATUSES].join(", ")}`),
      400,
    );
  }

  const existing = await db
    .prepare("SELECT id FROM offers WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Oferta no encontrada"), 404);

  const now = nowSqliteTs();
  await db
    .prepare("UPDATE offers SET status = ?, updated_at = ? WHERE id = ?")
    .bind(body.status, now, id)
    .run();

  return c.json({ success: true, data: { id, status: body.status } });
});

offerRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageOffers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para eliminar ofertas"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM offers WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Oferta no encontrada"), 404);

  const now = nowSqliteTs();
  await db
    .prepare("UPDATE offers SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return c.json({ success: true, data: { id } });
});
