import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const branchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /
branchRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const isActive = c.req.query("is_active");

  let query = "SELECT * FROM branches WHERE deleted_at IS NULL";
  const bindings: (string | number)[] = [];

  if (isActive !== undefined) {
    query += " AND is_active = ?";
    bindings.push(isActive === "false" ? 0 : 1);
  }

  query += " ORDER BY name ASC";

  const results = await db.prepare(query).bind(...bindings).all();
  return c.json({ success: true, data: results.results ?? [] });
});

// GET /:id
branchRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare("SELECT * FROM branches WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();

  if (!row) return c.json({ success: false, error: "Branch not found" }, 404);
  return c.json({ success: true, data: row });
});

// POST /
branchRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    name: string;
    code: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    opening_time?: string;
    closing_time?: string;
  }>();

  if (!body.name?.trim()) return c.json({ success: false, error: "name is required" }, 400);
  if (!body.code?.trim()) return c.json({ success: false, error: "code is required" }, 400);

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const existing = await db
    .prepare("SELECT id FROM branches WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .bind(body.code.trim().toUpperCase())
    .first<{ id: string }>();
  if (existing) return c.json({ success: false, error: "Branch code already exists" }, 409);

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT INTO branches (id, name, code, address, phone, email, timezone, opening_time, closing_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      body.name.trim(),
      body.code.trim().toUpperCase(),
      body.address ?? null,
      body.phone ?? null,
      body.email ?? null,
      body.timezone ?? "America/Argentina/Buenos_Aires",
      body.opening_time ?? "06:00",
      body.closing_time ?? "22:00",
      now,
      now
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id
branchRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    opening_time?: string;
    closing_time?: string;
    is_active?: boolean;
  }>();

  const existing = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Branch not found" }, 404);

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.address !== undefined) { fields.push("address = ?"); vals.push(body.address ?? null); }
  if (body.phone !== undefined) { fields.push("phone = ?"); vals.push(body.phone ?? null); }
  if (body.email !== undefined) { fields.push("email = ?"); vals.push(body.email ?? null); }
  if (body.timezone !== undefined) { fields.push("timezone = ?"); vals.push(body.timezone); }
  if (body.opening_time !== undefined) { fields.push("opening_time = ?"); vals.push(body.opening_time); }
  if (body.closing_time !== undefined) { fields.push("closing_time = ?"); vals.push(body.closing_time); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) return c.json({ success: false, error: "No fields to update" }, 400);

  fields.push("updated_at = ?");
  vals.push(now, id);

  await db.prepare(`UPDATE branches SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true, data: { id, updated_at: now } });
});

// DELETE /:id (soft delete — never delete the last active branch)
branchRoutes.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Branch not found" }, 404);

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const activeCount = await db
    .prepare("SELECT COUNT(*) as cnt FROM branches WHERE deleted_at IS NULL AND is_active = 1")
    .first<{ cnt: number }>();
  if ((activeCount?.cnt ?? 0) <= 1) {
    return c.json({ success: false, error: "Cannot delete the last active branch" }, 409);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE branches SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?")
    .bind(now, now, id)
    .run();

  return c.json({ success: true, data: { id, deleted_at: now } });
});
