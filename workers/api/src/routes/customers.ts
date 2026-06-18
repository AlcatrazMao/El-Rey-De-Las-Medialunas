import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const customerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / — Listar clientes activos con paginación y búsqueda opcional
customerRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const search = c.req.query("search");

  let query = "SELECT * FROM customers WHERE deleted_at IS NULL AND is_active = 1";
  const bindings: (string | number)[] = [];

  if (search) {
    query += " AND (name LIKE ? OR email LIKE ? OR document_number LIKE ?)";
    const term = `%${search}%`;
    bindings.push(term, term, term);
  }

  query += " ORDER BY name ASC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const [results, countRow] = await Promise.all([
    db.prepare(query).bind(...bindings).all(),
    db
      .prepare(
        "SELECT COUNT(*) as total FROM customers WHERE deleted_at IS NULL AND is_active = 1"
      )
      .first<{ total: number }>(),
  ]);

  return c.json({
    success: true,
    data: results.results ?? [],
    pagination: { total: countRow?.total ?? 0, limit, offset },
  });
});

// GET /search — Búsqueda rápida para dropdown en POSView
customerRoutes.get("/search", async (c) => {
  const db = c.env.DB;
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ success: true, data: [] });

  const term = `%${q}%`;
  const results = await db
    .prepare(
      "SELECT id, name, email, phone, type, credit_limit, current_debt FROM customers WHERE deleted_at IS NULL AND is_active = 1 AND (name LIKE ? OR email LIKE ? OR document_number LIKE ?) LIMIT 10"
    )
    .bind(term, term, term)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /:id — Detalle de cliente
customerRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();

  if (!row) return c.json({ success: false, error: "Customer not found" }, 404);
  return c.json({ success: true, data: row });
});

// POST / — Crear cliente
customerRoutes.post("/", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const body = await c.req.json<{
    name: string;
    email?: string;
    phone?: string;
    tax_id?: string;
    type?: string;
    credit_limit?: number;
    notes?: string;
  }>();

  if (!body.name?.trim()) {
    return c.json({ success: false, error: "name is required" }, 400);
  }

  // Map frontend type values to DB enum
  const typeMap: Record<string, string> = {
    consumidor_final: "consumer",
    frecuente: "frequent",
    mayorista: "wholesale",
    empresa: "corporate",
  };
  const dbType = typeMap[body.type ?? ""] ?? body.type ?? "consumer";
  const validTypes = ["consumer", "frequent", "wholesale", "corporate"];
  if (!validTypes.includes(dbType)) {
    return c.json({ success: false, error: "Invalid customer type" }, 400);
  }

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();

  await db
    .prepare(
      `INSERT INTO customers (id, name, email, phone, document_number, type, credit_limit, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      body.name.trim(),
      body.email ?? null,
      body.phone ?? null,
      body.tax_id ?? null,
      dbType,
      body.credit_limit ?? 0,
      body.notes ?? null
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id — Actualizar cliente
customerRoutes.put("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();
  if (!existing) return c.json({ success: false, error: "Customer not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    email?: string;
    phone?: string;
    tax_id?: string;
    credit_limit?: number;
    notes?: string;
    is_active?: number;
  }>();

  if (body.is_active !== undefined && body.is_active !== 0 && body.is_active !== 1) {
    return c.json({ success: false, error: "is_active must be 0 or 1" }, 400);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const fields: string[] = ["updated_at = ?"];
  const vals: (string | number | null)[] = [now];

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.email !== undefined) { fields.push("email = ?"); vals.push(body.email); }
  if (body.phone !== undefined) { fields.push("phone = ?"); vals.push(body.phone); }
  if (body.tax_id !== undefined) { fields.push("document_number = ?"); vals.push(body.tax_id); }
  if (body.credit_limit !== undefined) { fields.push("credit_limit = ?"); vals.push(body.credit_limit); }
  if (body.notes !== undefined) { fields.push("notes = ?"); vals.push(body.notes); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active); }

  if (fields.length === 1) return c.json({ success: true, data: { id } });

  vals.push(id);
  await db.prepare(`UPDATE customers SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();

  return c.json({ success: true, data: { id } });
});

// GET /:id/history — Historial de compras del cliente
customerRoutes.get("/:id/history", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  const results = await db
    .prepare(
      "SELECT id, sale_number, total, status, created_at FROM sales WHERE customer_id = ? AND status != 'voided' ORDER BY created_at DESC LIMIT ?"
    )
    .bind(id, limit)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});
