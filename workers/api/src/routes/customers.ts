import { Hono } from "hono";

import { resolveUser } from "../lib/resolve-user";
import { escapeLike } from "../lib/sql-escape";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const customerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_CREDIT_LIMIT = 10_000_000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// GET / — Listar clientes activos con paginación y búsqueda opcional
customerRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "100", 10) || 100), 500);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const search = c.req.query("search");

  let query = "SELECT * FROM customers WHERE deleted_at IS NULL AND is_active = 1";
  const bindings: (string | number)[] = [];

  if (search) {
    query += " AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR document_number LIKE ? ESCAPE '\\')";
    const term = `%${escapeLike(search)}%`;
    bindings.push(term, term, term);
  }

  query += " ORDER BY name ASC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  let countQuery = "SELECT COUNT(*) as total FROM customers WHERE deleted_at IS NULL AND is_active = 1";
  const countBindings: (string | number)[] = [];

  if (search) {
    countQuery += " AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR document_number LIKE ? ESCAPE '\\')";
    const term = `%${escapeLike(search)}%`;
    countBindings.push(term, term, term);
  }

  const [results, countRow] = await Promise.all([
    db.prepare(query).bind(...bindings).all(),
    countBindings.length > 0
      ? db.prepare(countQuery).bind(...countBindings).first<{ total: number }>()
      : db.prepare(countQuery).first<{ total: number }>(),
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

  const term = `%${escapeLike(q)}%`;
  const results = await db
    .prepare(
      "SELECT id, name, email, phone, type, credit_limit, current_debt FROM customers WHERE deleted_at IS NULL AND is_active = 1 AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR document_number LIKE ? ESCAPE '\\') LIMIT 10",
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
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL AND is_active = 1 LIMIT 1")
    .bind(id)
    .first();

  if (!row) return c.json(errBody("NOT_FOUND", "Cliente no encontrado"), 404);
  return c.json({ success: true, data: row });
});

// SECURITY: roles con permiso para crear/modificar clientes (escritura).
// Cajeros solo pueden leer — no crear ni alterar registros de clientes.
function canManageCustomers(role: string | undefined): boolean {
  return role === "admin" || role === "owner" || role === "supervisor";
}

// POST / — Crear cliente
customerRoutes.post("/", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: solo supervisor/admin/owner pueden crear clientes.
  // Cajeros, producción y depósito solo tienen acceso de lectura.
  if (!canManageCustomers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear clientes"), 403);
  }

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
    return c.json(errBody("VALIDATION_ERROR", "name es requerido"), 400);
  }

  // SECURITY: credit_limit is a financial field — validate it. Only admin/
  // owner/supervisor can set a non-zero credit limit so a cashier cannot
  // grant unlimited credit to a customer they collude with.
  if (body.credit_limit !== undefined && body.credit_limit !== null) {
    if (
      typeof body.credit_limit !== 'number' ||
      !Number.isFinite(body.credit_limit) ||
      body.credit_limit < 0 ||
      body.credit_limit > MAX_CREDIT_LIMIT
    ) {
      return c.json(errBody("VALIDATION_ERROR", "credit_limit debe ser un número finito >= 0"), 400);
    }
    const role = c.get("userRole");
    if (body.credit_limit > 0 && role !== "admin" && role !== "owner" && role !== "supervisor") {
      return c.json(errBody("FORBIDDEN", "No tienes permisos para asignar límite de crédito"), 403);
    }
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
    return c.json(errBody("VALIDATION_ERROR", "Tipo de cliente inválido"), 400);
  }

  const id = genId();
  const now = nowSqliteTs();

  await db
    .prepare(
      `INSERT INTO customers (id, name, email, phone, document_number, type, credit_limit, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      body.name.trim(),
      body.email ?? null,
      body.phone ?? null,
      body.tax_id ?? null,
      dbType,
      body.credit_limit ?? 0,
      body.notes ?? null,
      now,
      now,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// PUT /:id — Actualizar cliente
customerRoutes.put("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: guard general de rol — cualquier campo (name, email, phone, type,
  // notes) puede alterar datos operativos. Solo supervisor/admin/owner pueden
  // modificar clientes.
  if (!canManageCustomers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tenés permisos para editar clientes"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();
  if (!existing) return c.json(errBody("NOT_FOUND", "Cliente no encontrado"), 404);

  const body = await c.req.json<{
    name?: string;
    email?: string;
    phone?: string;
    tax_id?: string;
    type?: string;
    credit_limit?: number;
    notes?: string;
    is_active?: number;
  }>();

  if (body.is_active !== undefined && body.is_active !== 0 && body.is_active !== 1) {
    return c.json(errBody("VALIDATION_ERROR", "is_active debe ser 0 o 1"), 400);
  }

  // SECURITY: cambiar is_active puede deshabilitar clientes operativos.
  // Solo supervisor/admin/owner pueden hacerlo.
  if (body.is_active !== undefined && !canManageCustomers(c.get("userRole"))) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para cambiar el estado del cliente"), 403);
  }

  // SECURITY: same credit_limit guard as POST.
  if (body.credit_limit !== undefined && body.credit_limit !== null) {
    if (
      typeof body.credit_limit !== 'number' ||
      !Number.isFinite(body.credit_limit) ||
      body.credit_limit < 0 ||
      body.credit_limit > MAX_CREDIT_LIMIT
    ) {
      return c.json(errBody("VALIDATION_ERROR", "credit_limit debe ser un número finito >= 0"), 400);
    }
    const role = c.get("userRole");
    if (role !== "admin" && role !== "owner" && role !== "supervisor") {
      return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar el límite de crédito"), 403);
    }
  }

  // Map frontend type values to DB enum — mismo mapeo que POST.
  let dbType: string | undefined;
  if (body.type !== undefined) {
    const typeMap: Record<string, string> = {
      consumidor_final: "consumer",
      frecuente: "frequent",
      mayorista: "wholesale",
      empresa: "corporate",
    };
    dbType = typeMap[body.type] ?? body.type;
    const validTypes = ["consumer", "frequent", "wholesale", "corporate"];
    if (!validTypes.includes(dbType)) {
      return c.json(errBody("VALIDATION_ERROR", "Tipo de cliente inválido"), 400);
    }
  }

  const now = nowSqliteTs();
  const fields: string[] = ["updated_at = ?"];
  const vals: (string | number | null)[] = [now];

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.email !== undefined) { fields.push("email = ?"); vals.push(body.email ?? null); }
  if (body.phone !== undefined) { fields.push("phone = ?"); vals.push(body.phone ?? null); }
  if (body.tax_id !== undefined) { fields.push("document_number = ?"); vals.push(body.tax_id ?? null); }
  if (dbType !== undefined) { fields.push("type = ?"); vals.push(dbType); }
  if (body.credit_limit !== undefined) { fields.push("credit_limit = ?"); vals.push(body.credit_limit ?? null); }
  if (body.notes !== undefined) { fields.push("notes = ?"); vals.push(body.notes ?? null); }
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
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10), 1), 200);

  const results = await db
    .prepare(
      "SELECT id, sale_number, total, status, created_at FROM sales WHERE customer_id = ? AND status != 'voided' ORDER BY created_at DESC LIMIT ?",
    )
    .bind(id, limit)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});
