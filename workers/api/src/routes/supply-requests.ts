import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const supplyRequestRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();
const MAX_QUANTITY = 1_000_000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// GET /
supplyRequestRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const status = c.req.query("status");
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

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
    return c.json(errBody("NOT_FOUND", "Solicitud de abastecimiento no encontrada"), 404);
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
      errBody("VALIDATION_ERROR", "type, item_id, item_name, quantity, unit y requested_by son requeridos"),
      400,
    );
  }
  if (
    typeof body.quantity !== 'number' ||
    !Number.isFinite(body.quantity) ||
    body.quantity <= 0 ||
    body.quantity > MAX_QUANTITY
  ) {
    return c.json(errBody("VALIDATION_ERROR", "quantity es requerido y debe ser un número finito > 0"), 400);
  }

  // Política de ID: aceptamos solo hex-32 (formato canónico de genId()).
  // Si el body trae un id que no matchea, lo ignoramos silenciosamente y
  // generamos uno server-side — no retornamos 400. Esto evita DoS por colisión
  // de IDs predecibles y es coherente con el comentario original del código.
  const clientIdValid = typeof body.id === 'string' && /^[a-f0-9]{32}$/.test(body.id);

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: solo roles con responsabilidad operativa pueden crear solicitudes
  // de abastecimiento. Roles de producción/depósito sin autorización financiera
  // no deben poder generarlas.
  const userRole = c.get("userRole");
  const ALLOWED_ROLES = new Set(["cashier", "supervisor", "admin", "owner"]);
  if (!ALLOWED_ROLES.has(userRole as string)) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear solicitudes de abastecimiento"), 403);
  }

  const id = clientIdValid ? (body.id as string) : genId();
  const now = nowSqliteTs();

  const insertResult = await db
    .prepare(
      `INSERT OR IGNORE INTO supply_requests
         (id, branch_id, user_id, type, item_id, item_name, quantity, unit, reason, requested_by, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      branchId,
      user.id,
      body.type,
      body.item_id,
      body.item_name,
      body.quantity,
      body.unit,
      body.reason ?? null,
      body.requested_by,
      now,
      now,
    )
    .run();

  if (!insertResult.meta?.changes) {
    return c.json({ success: true, data: { id, already_existed: true } }, 200);
  }

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
      errBody("VALIDATION_ERROR", "status debe ser 'approved' o 'rejected'"),
      400,
    );
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== 'admin' && userRole !== 'owner' && userRole !== 'supervisor') {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para aprobar/rechazar solicitudes"), 403);
  }

  // Fix R7-2 — ALTO: verificar que la solicitud existe y pertenece al branch del usuario.
  const existing = await db
    .prepare("SELECT id, branch_id, status FROM supply_requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; branch_id: string; status: string }>();

  if (!existing) {
    return c.json(errBody("NOT_FOUND", "Solicitud de abastecimiento no encontrada"), 404);
  }

  // Validar branch membership para no-admin/owner.
  if (userRole !== 'admin' && userRole !== 'owner') {
    const branchId = c.get("branchId") ?? "";
    if (existing.branch_id !== branchId) {
      return c.json(errBody("FORBIDDEN", "No tenés acceso a la solicitud de esa sucursal"), 403);
    }
  }

  const updatedAt = nowSqliteTs();

  // Prevenir override de decisiones ya tomadas: solo actualizar si status = 'pending'.
  const updateResult = await db
    .prepare(
      `UPDATE supply_requests SET status = ?, admin_memo = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .bind(body.status, body.admin_memo ?? null, updatedAt, id)
    .run();

  if (updateResult.meta.changes === 0) {
    return c.json(errBody("ALREADY_RESOLVED", "La solicitud ya fue aprobada o rechazada"), 409);
  }

  return c.json({ success: true, data: { id, status: body.status, updated_at: updatedAt } });
});
