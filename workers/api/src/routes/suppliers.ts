import { Hono } from "hono";

import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";

export const supplierRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

function canManageSuppliers(role: string | undefined): boolean {
  return role === "admin" || role === "owner" || role === "supervisor";
}

// GET /
supplierRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const search = c.req.query("search");
  const isActive = c.req.query("is_active");
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

  let query = "SELECT * FROM suppliers WHERE deleted_at IS NULL";
  const bindings: (string | number)[] = [];

  if (search) {
    query += " AND (name LIKE ? OR contact_name LIKE ? OR email LIKE ?)";
    const like = `%${search}%`;
    bindings.push(like, like, like);
  }
  if (isActive !== undefined) {
    query += " AND is_active = ?";
    bindings.push(isActive === "false" ? 0 : 1);
  }

  query += " ORDER BY name ASC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db.prepare(query).bind(...bindings).all();
  return c.json({ success: true, data: results.results ?? [] });
});

// GET /:id
supplierRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare("SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();

  if (!row) return c.json(errBody("NOT_FOUND", "Proveedor no encontrado"), 404);
  return c.json({ success: true, data: row });
});

// POST /
supplierRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    tax_id?: string;
    payment_terms?: string;
    notes?: string;
  }>();

  if (!body.name?.trim()) {
    return c.json(errBody("VALIDATION_ERROR", "name es requerido"), 400);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageSuppliers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear proveedores"), 403);
  }

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT INTO suppliers (id, name, contact_name, email, phone, address, tax_id, payment_terms, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      body.name.trim(),
      body.contact_name ?? null,
      body.email ?? null,
      body.phone ?? null,
      body.address ?? null,
      body.tax_id ?? null,
      body.payment_terms ?? null,
      body.notes ?? null,
      now,
      now,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id
supplierRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    tax_id?: string;
    payment_terms?: string;
    notes?: string;
    is_active?: boolean;
  }>();

  const existing = await db
    .prepare("SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) return c.json(errBody("NOT_FOUND", "Proveedor no encontrado"), 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageSuppliers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar proveedores"), 403);
  }

  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.contact_name !== undefined) { fields.push("contact_name = ?"); vals.push(body.contact_name ?? null); }
  if (body.email !== undefined) { fields.push("email = ?"); vals.push(body.email ?? null); }
  if (body.phone !== undefined) { fields.push("phone = ?"); vals.push(body.phone ?? null); }
  if (body.address !== undefined) { fields.push("address = ?"); vals.push(body.address ?? null); }
  if (body.tax_id !== undefined) { fields.push("tax_id = ?"); vals.push(body.tax_id ?? null); }
  if (body.payment_terms !== undefined) { fields.push("payment_terms = ?"); vals.push(body.payment_terms ?? null); }
  if (body.notes !== undefined) { fields.push("notes = ?"); vals.push(body.notes ?? null); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);

  fields.push("updated_at = ?");
  vals.push(now, id);

  await db
    .prepare(`UPDATE suppliers SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();

  return c.json({ success: true, data: { id, updated_at: now } });
});

// DELETE /:id (soft delete)
supplierRoutes.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) return c.json(errBody("NOT_FOUND", "Proveedor no encontrado"), 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para eliminar proveedores"), 403);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE suppliers SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?")
    .bind(now, now, id)
    .run();

  return c.json({ success: true, data: { id, deleted_at: now } });
});
