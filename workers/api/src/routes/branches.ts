import { Hono } from "hono";

import { DOCUMENT_TYPES } from "../lib/document-sequences";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const branchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// SECURITY/CONSISTENCY: opening_time / closing_time se persisten como TEXT
// y se usan más adelante para reportes y filtros de POS. Si dejamos que el
// cliente mande strings arbitrarias ("8am", "abc", "25:99") rompe parseos
// downstream. Forzamos formato HH:MM 24h.
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

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

  if (!row) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } }, 404);
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

  if (!body.name?.trim()) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "name es requerido" } }, 400);
  if (!body.code?.trim()) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "code es requerido" } }, 400);

  if (body.opening_time !== undefined && !TIME_REGEX.test(body.opening_time)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "opening_time debe tener formato HH:MM" } }, 400);
  }
  if (body.closing_time !== undefined && !TIME_REGEX.test(body.closing_time)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "closing_time debe tener formato HH:MM" } }, 400);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  // Only admin/owner can create branches (high-impact operation)
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para crear sucursales" } }, 403);
  }

  const existing = await db
    .prepare("SELECT id FROM branches WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .bind(body.code.trim().toUpperCase())
    .first<{ id: string }>();
  if (existing) return c.json({ success: false, error: { code: "CONFLICT", message: "Ya existe una sucursal con ese código" } }, 409);

  const id = genId();
  const now = nowSqliteTs();

  // CONSISTENCY (SDD document-types, migración 0023): toda sucursal necesita
  // una fila en document_sequences y otra en document_type_settings por cada
  // uno de los 7 tipos de comprobante. La migración 0023 sembró esto para las
  // sucursales que ya existían en ese momento (INSERT OR IGNORE ... CROSS JOIN
  // sobre branches), pero una sucursal creada DESPUÉS de esa migración nunca
  // recibía esas 14 filas: sin fila en document_type_settings, sales.ts
  // rechaza CUALQUIER venta (incluso 'ticket', que debería estar habilitado
  // por defecto) con 409 DOCUMENT_TYPE_DISABLED, y nextSequence() en
  // document-sequences.ts tira si no encuentra fila en document_sequences.
  // Sembramos las 14 filas en el mismo db.batch que crea la sucursal para que
  // sea atómico: o se crea la sucursal totalmente lista para operar, o no se
  // crea nada (evita dejarla a medio configurar si un paso posterior fallara).
  // Mismo criterio que 0023: 'ticket' habilitado, los otros 6 deshabilitados.
  await db.batch([
    db
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
      ),
    ...DOCUMENT_TYPES.map((documentType) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO document_sequences (branch_id, document_type, last_number, updated_at)
           VALUES (?, ?, 0, ?)`
        )
        .bind(id, documentType, now)
    ),
    ...DOCUMENT_TYPES.map((documentType) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO document_type_settings (branch_id, document_type, enabled, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(id, documentType, documentType === "ticket" ? 1 : 0, now, userId || null)
    ),
  ]);

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
  if (!existing) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } }, 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  // SECURITY: only admin/owner can modify branches.
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para modificar sucursales" } }, 403);
  }

  if (body.opening_time !== undefined && !TIME_REGEX.test(body.opening_time)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "opening_time debe tener formato HH:MM" } }, 400);
  }
  if (body.closing_time !== undefined && !TIME_REGEX.test(body.closing_time)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "closing_time debe tener formato HH:MM" } }, 400);
  }

  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = nowSqliteTs();

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.address !== undefined) { fields.push("address = ?"); vals.push(body.address ?? null); }
  if (body.phone !== undefined) { fields.push("phone = ?"); vals.push(body.phone ?? null); }
  if (body.email !== undefined) { fields.push("email = ?"); vals.push(body.email ?? null); }
  if (body.timezone !== undefined) { fields.push("timezone = ?"); vals.push(body.timezone); }
  if (body.opening_time !== undefined) { fields.push("opening_time = ?"); vals.push(body.opening_time); }
  if (body.closing_time !== undefined) { fields.push("closing_time = ?"); vals.push(body.closing_time); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "No hay campos para actualizar" } }, 400);

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
  if (!existing) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } }, 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  // SECURITY: only admin/owner can delete branches.
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para eliminar sucursales" } }, 403);
  }

  // GUARD: no permitir eliminar una sucursal con sesiones de caja abiertas.
  // Una caja abierta implica un turno activo que aún no rindió: eliminar la
  // sucursal deja la sesión huérfana y rompe el cierre contable.
  const openSessions = await db
    .prepare("SELECT COUNT(*) as count FROM cash_sessions WHERE branch_id = ? AND status = 'open'")
    .bind(id)
    .first<{ count: number }>();
  if ((openSessions?.count ?? 0) > 0) {
    return c.json(
      { success: false, error: { code: "CONFLICT", message: "La sucursal tiene sesiones de caja abiertas. Cerralas antes de eliminarla." } },
      409,
    );
  }

  // SECURITY: atomic guard contra race condition de "última sucursal activa".
  // Antes hacíamos: (1) SELECT COUNT activas, (2) UPDATE soft-delete.
  // Entre 1 y 2, dos admins pueden borrar las dos últimas simultáneamente,
  // dejando el sistema sin sucursales operativas. Lo resolvemos en un único
  // UPDATE con subquery: el WHERE solo dispara si quedan > 1 activas en el
  // mismo statement, lo que SQLite serializa.
  const now = nowSqliteTs();
  const result = await db
    .prepare(
      `UPDATE branches SET deleted_at = ?, is_active = 0, updated_at = ?
       WHERE id = ?
         AND (SELECT COUNT(*) FROM branches WHERE deleted_at IS NULL AND is_active = 1) > 1`,
    )
    .bind(now, now, id)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ success: false, error: { code: "CONFLICT", message: "No podés eliminar la única sucursal activa" } }, 409);
  }

  return c.json({ success: true, data: { id, deleted_at: now } });
});
