import { Hono } from "hono";

import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";

export const categoryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

function canManageCategories(role: string | undefined): boolean {
  return role === "admin" || role === "owner" || role === "supervisor";
}

// GET / — flat list
categoryRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const isActive = c.req.query("is_active");

  let query = "SELECT * FROM categories WHERE branch_id = ? AND deleted_at IS NULL";
  const bindings: (string | number)[] = [branchId];

  if (isActive !== undefined) {
    query += " AND is_active = ?";
    bindings.push(isActive === "false" ? 0 : 1);
  }

  query += " ORDER BY sort_order ASC, name ASC";

  const results = await db.prepare(query).bind(...bindings).all();
  return c.json({ success: true, data: results.results ?? [] });
});

// GET /tree — nested tree
categoryRoutes.get("/tree", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;

  const results = await db
    .prepare(
      "SELECT * FROM categories WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY sort_order ASC, name ASC",
    )
    .bind(branchId)
    .all<{ id: string; parent_id: string | null; name: string; icon: string | null; color: string | null; sort_order: number }>();

  const rows = results.results ?? [];
  const map = new Map<string, typeof rows[0] & { children: typeof rows }>();
  rows.forEach(r => map.set(r.id, { ...r, children: [] }));

  const tree: typeof rows = [];
  rows.forEach(r => {
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id)!.children.push(map.get(r.id)!);
    } else {
      tree.push(map.get(r.id)!);
    }
  });

  return c.json({ success: true, data: tree });
});

// GET /:id
categoryRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();

  if (!row) return c.json(errBody("NOT_FOUND", "Categoría no encontrada"), 404);
  return c.json({ success: true, data: row });
});

// POST /
categoryRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    name: string;
    parent_id?: string | null;
    branch_id?: string;
    icon?: string;
    color?: string;
    sort_order?: number;
  }>();

  if (!body.name?.trim()) {
    return c.json(errBody("VALIDATION_ERROR", "name es requerido"), 400);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageCategories(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear categorías"), 403);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (body.parent_id) {
    const parent = await db
      .prepare("SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1")
      .bind(body.parent_id)
      .first<{ id: string }>();
    if (!parent) return c.json(errBody("NOT_FOUND", "Categoría padre no encontrada"), 404);
  }

  await db
    .prepare(
      `INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      body.parent_id ?? null,
      branchId,
      body.name.trim(),
      body.icon ?? null,
      body.color ?? "#8B4513",
      body.sort_order ?? 0,
      now,
      now,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id
categoryRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    parent_id?: string | null;
    icon?: string | null;
    color?: string | null;
    sort_order?: number;
    is_active?: boolean;
  }>();

  const existing = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) return c.json(errBody("NOT_FOUND", "Categoría no encontrada"), 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  if (!canManageCategories(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar categorías"), 403);
  }

  // SECURITY: prevent setting parent_id to self (would create a self-referencing
  // cycle the tree builder cannot handle).
  if (body.parent_id !== undefined && body.parent_id === id) {
    return c.json(errBody("VALIDATION_ERROR", "Una categoría no puede ser su propio padre"), 400);
  }

  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.parent_id !== undefined) { fields.push("parent_id = ?"); vals.push(body.parent_id ?? null); }
  if (body.icon !== undefined) { fields.push("icon = ?"); vals.push(body.icon ?? null); }
  if (body.color !== undefined) { fields.push("color = ?"); vals.push(body.color ?? null); }
  if (body.sort_order !== undefined) { fields.push("sort_order = ?"); vals.push(body.sort_order); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);

  fields.push("updated_at = ?");
  vals.push(now, id);

  await db
    .prepare(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();

  return c.json({ success: true, data: { id, updated_at: now } });
});

// DELETE /:id (soft delete)
categoryRoutes.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) return c.json(errBody("NOT_FOUND", "Categoría no encontrada"), 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const role = c.get("userRole");
  if (role !== "admin" && role !== "owner") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para eliminar categorías"), 403);
  }

  const inUse = await db
    .prepare("SELECT id FROM products WHERE category_id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();

  if (inUse) {
    return c.json(errBody("CONFLICT", "No se puede eliminar la categoría: tiene productos activos"), 409);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE categories SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?")
    .bind(now, now, id)
    .run();

  return c.json({ success: true, data: { id, deleted_at: now } });
});
