import { Hono } from "hono";

import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const requestsRouter = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Constantes ────────────────────────────────────────────────────────────
const VALID_TYPES = ["supply", "production", "delivery", "task", "maintenance", "custom"] as const;
const VALID_ROLES = ["admin", "cajero", "cocinero", "repartidor", "panadero", "all"] as const;
const VALID_PRIORITIES = ["low", "medium", "high"] as const;

type RequestType = (typeof VALID_TYPES)[number];
type AssignedRole = (typeof VALID_ROLES)[number];
type Priority = (typeof VALID_PRIORITIES)[number];

// Roles administrativos (pueden aprobar/rechazar/cancelar)
const ADMIN_ROLES = new Set<string>(["admin", "owner", "supervisor"]);

// Roles que pueden crear solicitudes (todos los operativos)
const CREATOR_ROLES = new Set<string>([
  "admin",
  "owner",
  "supervisor",
  "cajero",
  "cocinero",
  "repartidor",
  "panadero",
]);

// Límites de validación
const MAX_TITLE_LEN = 200;
const MAX_DESCRIPTION_LEN = 1000;
const MAX_INCIDENTS_LEN = 500;
const MAX_COST = 10_000_000;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MIN_REJECT_REASON_LEN = 3;
const MIN_REASSIGNMENT_NOTE_LEN = 5;

// Lista explícita de campos de requests (NUNCA SELECT *).
const REQUEST_FIELDS = [
  "id",
  "type",
  "title",
  "description",
  "priority",
  "created_by_user_id",
  "created_by_role",
  "assigned_role",
  "assigned_user_id",
  "branch_id",
  "is_permanent",
  "recurrence_days",
  "recurrence_time",
  "status",
  "accepted_by_user_id",
  "accepted_by_role",
  "is_optional_acceptance",
  "original_assigned_role",
  "admin_note",
  "rejection_reason",
  "reassignment_note",
  "cost_spent",
  "time_started",
  "time_completed",
  "duration_minutes",
  "incidents",
  "created_at",
  "updated_at",
].join(", ");

// Variante con alias de tabla para queries con JOIN (incluye branch_name).
const REQUEST_FIELDS_JOIN = `
  r.id, r.type, r.title, r.description, r.priority,
  r.created_by_user_id, r.created_by_role,
  r.assigned_role, r.assigned_user_id, r.branch_id,
  r.is_permanent, r.recurrence_days, r.recurrence_time,
  r.status,
  r.accepted_by_user_id, r.accepted_by_role, r.is_optional_acceptance, r.original_assigned_role,
  r.admin_note, r.rejection_reason, r.reassignment_note,
  r.cost_spent, r.time_started, r.time_completed, r.duration_minutes, r.incidents,
  r.created_at, r.updated_at,
  b.name AS branch_name
`.trim();

// ─── Helpers ───────────────────────────────────────────────────────────────
const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

interface RequestRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  priority: string;
  created_by_user_id: string | null;
  created_by_role: string;
  assigned_role: string;
  assigned_user_id: string | null;
  branch_id: string | null;
  is_permanent: number;
  recurrence_days: string | null;
  recurrence_time: string | null;
  status: string;
  accepted_by_user_id: string | null;
  accepted_by_role: string | null;
  is_optional_acceptance: number;
  original_assigned_role: string | null;
  admin_note: string | null;
  rejection_reason: string | null;
  reassignment_note: string | null;
  cost_spent: number | null;
  time_started: string | null;
  time_completed: string | null;
  duration_minutes: number | null;
  incidents: string | null;
  created_at: string;
  updated_at: string;
  branch_name?: string | null;
}

interface UserInfo {
  id: string;
  name: string | null;
}

/**
 * Trae el id + name del usuario para enriquecer entries de request_activity.
 * resolveUser() solo devuelve { id }, así que necesitamos una query separada.
 */
async function fetchUserName(
  db: D1Database,
  userId: string,
): Promise<UserInfo | null> {
  return db
    .prepare("SELECT id, name FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<UserInfo>();
}

/**
 * Inserta una entry en request_activity. Usa una sola statement preparada
 * para que el caller pueda decidir si batchearla con otros writes.
 */
function buildActivityInsert(
  db: D1Database,
  args: {
    requestId: string;
    userId: string | null;
    userRole: string | null;
    userName: string | null;
    action:
      | "created"
      | "approved"
      | "rejected"
      | "accepted"
      | "accepted_optional"
      | "started"
      | "completed"
      | "reassignment_requested"
      | "reassignment_approved"
      | "cancelled"
      | "comment"
      | "edited";
    note: string | null;
  },
) {
  return db
    .prepare(
      `INSERT INTO request_activity (id, request_id, user_id, user_role, user_name, action, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      genId(),
      args.requestId,
      args.userId,
      args.userRole,
      args.userName,
      args.action,
      args.note,
      nowSqliteTs(),
    );
}

// ─── GET /version ──────────────────────────────────────────────────────────
// El frontend compara version local vs remota para decidir refetch.
requestsRouter.get("/version", async (c) => {
  const db = c.env.DB;
  const row = await db
    .prepare("SELECT version, updated_at FROM data_versions WHERE key = 'requests' LIMIT 1")
    .first<{ version: number; updated_at: string }>();

  if (!row) {
    // Si no existe la row, devolvemos version=0 — el frontend tratará todo como nuevo.
    return c.json({ success: true, data: { version: 0, updated_at: null } });
  }
  return c.json({ success: true, data: { version: row.version, updated_at: row.updated_at } });
});

// ─── GET / (list) ──────────────────────────────────────────────────────────
requestsRouter.get("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  const isAdmin = ADMIN_ROLES.has(userRole ?? "");

  // Filtros
  const statusFilter = c.req.query("status");
  const assignedRoleFilter = c.req.query("assigned_role");
  const typeFilter = c.req.query("type");
  const branchIdFilter = c.req.query("branch_id");
  const isPermanentFilter = c.req.query("is_permanent");

  const rawLimit = parseInt(c.req.query("limit") ?? String(DEFAULT_LIMIT), 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1), MAX_LIMIT);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

  const whereParts: string[] = [];
  const bindings: (string | number)[] = [];

  if (statusFilter) {
    whereParts.push("status = ?");
    bindings.push(statusFilter);
  }
  if (assignedRoleFilter) {
    whereParts.push("assigned_role = ?");
    bindings.push(assignedRoleFilter);
  }
  if (typeFilter) {
    whereParts.push("type = ?");
    bindings.push(typeFilter);
  }
  if (branchIdFilter) {
    whereParts.push("branch_id = ?");
    bindings.push(branchIdFilter);
  }
  if (isPermanentFilter === "0" || isPermanentFilter === "1") {
    whereParts.push("is_permanent = ?");
    bindings.push(Number(isPermanentFilter));
  }

  // RBAC: no-admin solo ve lo que le compete.
  //   - solicitudes asignadas a su rol O al rol 'all'
  //   - solicitudes 'approved' de cualquier rol (visibles como Opcionales)
  //   - solicitudes que él aceptó opcionalmente
  //   - solicitudes creadas por él mismo (incluso si cancelled/rejected)
  // Y excluir 'cancelled' / 'rejected' a menos que las haya creado él.
  if (!isAdmin) {
    whereParts.push(
      `(
         assigned_role = ?
         OR assigned_role = 'all'
         OR (status = 'approved' AND (assigned_role = ? OR assigned_role = 'all' OR is_optional_acceptance = 1))
         OR accepted_by_user_id = ?
         OR created_by_user_id = ?
       )`,
    );
    bindings.push(userRole ?? "", userRole ?? "", user.id, user.id);

    whereParts.push(
      `(status NOT IN ('cancelled', 'rejected') OR created_by_user_id = ?)`,
    );
    bindings.push(user.id);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // COUNT + SELECT en un batch para ver el mismo snapshot de datos
  const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM requests ${whereClause}`).bind(...bindings);
  const listStmt = db
    .prepare(`SELECT ${REQUEST_FIELDS} FROM requests ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset);

  const [countResult, listResult] = await db.batch([countStmt, listStmt]);
  const total = (countResult.results[0] as { total: number } | undefined)?.total ?? 0;
  const rows = (listResult.results ?? []) as RequestRow[];

  return c.json({
    success: true,
    data: rows,
    total,
  });
});

// ─── GET /:id (detail + activity) ──────────────────────────────────────────
requestsRouter.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No autenticado' } }, 401);

  const userRole = c.get("userRole") as string | undefined;

  const request = await db
    .prepare(`SELECT ${REQUEST_FIELDS} FROM requests WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<RequestRow>();

  if (!request) {
    return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  }

  const isAdmin = ADMIN_ROLES.has(userRole ?? "");
  if (!isAdmin) {
    const canSee =
      request.assigned_role === userRole ||
      request.assigned_role === 'all' ||
      request.accepted_by_user_id === user.id ||
      request.created_by_user_id === user.id ||
      (request.status === 'approved' && request.is_optional_acceptance === 1);
    if (!canSee) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Sin acceso' } }, 403);
  }

  const activity = await db
    .prepare(
      `SELECT id, request_id, user_id, user_role, user_name, action, note, created_at
       FROM request_activity
       WHERE request_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(id)
    .all();

  return c.json({
    success: true,
    data: {
      request,
      activity: activity.results ?? [],
    },
  });
});

// ─── POST / (crear) ────────────────────────────────────────────────────────
requestsRouter.post("/", async (c) => {
  const db = c.env.DB;

  let body: {
    type?: string;
    title?: string;
    description?: string | null;
    priority?: string;
    assigned_role?: string;
    assigned_user_id?: string | null;
    branch_id?: string | null;
    is_permanent?: boolean | number;
    recurrence_days?: unknown;
    recurrence_time?: string | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(errBody("VALIDATION_ERROR", "Body JSON inválido"), 400);
  }

  // Validar tipo
  if (!body.type || !VALID_TYPES.includes(body.type as RequestType)) {
    return c.json(
      errBody("VALIDATION_ERROR", `type es requerido y debe ser uno de: ${VALID_TYPES.join(", ")}`),
      400,
    );
  }
  // Validar title
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > MAX_TITLE_LEN) {
    return c.json(
      errBody("VALIDATION_ERROR", `title es requerido (1-${MAX_TITLE_LEN} caracteres)`),
      400,
    );
  }
  // Validar description
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") {
      return c.json(errBody("VALIDATION_ERROR", "description debe ser string"), 400);
    }
    if (body.description.length > MAX_DESCRIPTION_LEN) {
      return c.json(
        errBody("VALIDATION_ERROR", `description no puede exceder ${MAX_DESCRIPTION_LEN} caracteres`),
        400,
      );
    }
  }
  // Validar assigned_role
  if (!body.assigned_role || !VALID_ROLES.includes(body.assigned_role as AssignedRole)) {
    return c.json(
      errBody(
        "VALIDATION_ERROR",
        `assigned_role es requerido y debe ser uno de: ${VALID_ROLES.join(", ")}`,
      ),
      400,
    );
  }
  // Validar priority (opcional, default medium)
  if (body.priority !== undefined && body.priority !== null && !VALID_PRIORITIES.includes(body.priority as Priority)) {
    return c.json(
      errBody("VALIDATION_ERROR", `priority debe ser uno de: ${VALID_PRIORITIES.join(", ")}`),
      400,
    );
  }
  const priority: Priority = VALID_PRIORITIES.includes(body.priority as Priority)
    ? (body.priority as Priority)
    : "medium";

  // Recurrencia
  const isPermanent = body.is_permanent === true || body.is_permanent === 1 ? 1 : 0;
  let recurrenceDaysJson: string | null = null;
  if (isPermanent) {
    if (!Array.isArray(body.recurrence_days) || body.recurrence_days.length === 0) {
      return c.json(
        errBody(
          "VALIDATION_ERROR",
          "recurrence_days es requerido para solicitudes permanentes (array no vacío)",
        ),
        400,
      );
    }
    for (const d of body.recurrence_days) {
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
        return c.json(
          errBody(
            "VALIDATION_ERROR",
            "recurrence_days debe ser un array de enteros entre 0 (Dom) y 6 (Sab)",
          ),
          400,
        );
      }
    }
    recurrenceDaysJson = JSON.stringify(body.recurrence_days);
  }
  // Si no es permanente, recurrence_days y recurrence_time se ignoran.

  let recurrenceTime: string | null = null;
  if (body.recurrence_time !== undefined && body.recurrence_time !== null) {
    if (typeof body.recurrence_time !== "string") {
      return c.json(
        errBody("VALIDATION_ERROR", "recurrence_time debe tener formato HH:MM"),
        400,
      );
    }
    const [hh, mm] = body.recurrence_time.split(':').map(Number);
    if (!/^\d{2}:\d{2}$/.test(body.recurrence_time) || hh > 23 || mm > 59) {
      return c.json(
        errBody("VALIDATION_ERROR", "recurrence_time inválido (HH:MM 00:00-23:59)"),
        400,
      );
    }
    recurrenceTime = body.recurrence_time;
  }

  // Resolver usuario y rol
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole || !CREATOR_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "No tenés permisos para crear solicitudes"), 403);
  }

  // Auto-aprobación si es admin
  const initialStatus = ADMIN_ROLES.has(userRole) ? "approved" : "pending_approval";

  const userInfo = await fetchUserName(db, user.id);
  const id = genId();
  const now = nowSqliteTs();

  const insertStmt = db.prepare(
    `INSERT INTO requests (
       id, type, title, description, priority,
       created_by_user_id, created_by_role,
       assigned_role, assigned_user_id, branch_id,
       is_permanent, recurrence_days, recurrence_time,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    body.type,
    title,
    body.description ?? null,
    priority,
    user.id,
    userRole,
    body.assigned_role,
    body.assigned_user_id ?? null,
    body.branch_id ?? null,
    isPermanent,
    recurrenceDaysJson,
    recurrenceTime,
    initialStatus,
    now,
    now,
  );

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "created",
    note: initialStatus === "approved" ? "Auto-aprobado por admin" : null,
  });

  await db.batch([insertStmt, activityStmt]);

  return c.json({ success: true, data: { id, status: initialStatus } }, 201);
});

// ─── PATCH /:id/approve ────────────────────────────────────────────────────
requestsRouter.patch("/:id/approve", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  let body: { admin_note?: string | null } = {};
  try {
    body = await c.req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  if (body.admin_note && typeof body.admin_note === 'string' && body.admin_note.length > 500) {
    return c.json(errBody('VALIDATION_ERROR', 'admin_note no puede superar 500 caracteres'), 400);
  }
  const adminNote = typeof body.admin_note === 'string' ? body.admin_note.trim() : null;

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo administradores pueden aprobar solicitudes"), 403);
  }

  const existing = await db
    .prepare("SELECT id, status FROM requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "pending_approval") {
    return c.json(
      errBody("INVALID_STATE", `Solo se puede aprobar desde 'pending_approval' (actual: ${existing.status})`),
      409,
    );
  }

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  const updateStmt = db
    .prepare(
      `UPDATE requests SET status = 'approved', admin_note = ?, updated_at = ?
       WHERE id = ? AND status = 'pending_approval'`,
    )
    .bind(adminNote, now, id);

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "approved",
    note: adminNote,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "approved", updated_at: now } });
});

// ─── PATCH /:id/reject ─────────────────────────────────────────────────────
requestsRouter.patch("/:id/reject", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  let body: { rejection_reason?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(errBody("VALIDATION_ERROR", "Body JSON inválido"), 400);
  }
  const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
  if (reason.length < MIN_REJECT_REASON_LEN) {
    return c.json(
      errBody(
        "VALIDATION_ERROR",
        `rejection_reason es requerido (mínimo ${MIN_REJECT_REASON_LEN} caracteres)`,
      ),
      400,
    );
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo administradores pueden rechazar solicitudes"), 403);
  }

  const existing = await db
    .prepare("SELECT id, status FROM requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "pending_approval") {
    return c.json(
      errBody("INVALID_STATE", `Solo se puede rechazar desde 'pending_approval' (actual: ${existing.status})`),
      409,
    );
  }

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  const updateStmt = db
    .prepare(
      `UPDATE requests SET status = 'rejected', rejection_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'pending_approval'`,
    )
    .bind(reason, now, id);

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "rejected",
    note: reason,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "rejected", updated_at: now } });
});

// ─── PATCH /:id/accept ─────────────────────────────────────────────────────
requestsRouter.patch("/:id/accept", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole || !CREATOR_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Rol no autorizado para aceptar solicitudes"), 403);
  }

  const existing = await db
    .prepare(
      `SELECT id, status, assigned_role FROM requests WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; status: string; assigned_role: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "approved") {
    return c.json(
      errBody("INVALID_STATE", `Solo se puede aceptar desde 'approved' (actual: ${existing.status})`),
      409,
    );
  }

  // Determinar si es aceptación normal u opcional.
  // 'all' = cualquier rol puede aceptarla como normal (no opcional).
  const isNormal = existing.assigned_role === userRole || existing.assigned_role === "all";
  const isOptional = !isNormal;

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  // Si es opcional: guardamos original_assigned_role y reasignamos al rol del aceptante.
  // Si es normal: NO tocamos assigned_role.
  let updateStmt;
  if (isOptional) {
    updateStmt = db
      .prepare(
        `UPDATE requests
            SET status = 'accepted',
                accepted_by_user_id = ?,
                accepted_by_role = ?,
                is_optional_acceptance = 1,
                original_assigned_role = ?,
                assigned_role = ?,
                time_started = datetime('now'),
                updated_at = ?
          WHERE id = ? AND status = 'approved'`,
      )
      .bind(user.id, userRole, existing.assigned_role, userRole, now, id);
  } else {
    updateStmt = db
      .prepare(
        `UPDATE requests
            SET status = 'accepted',
                accepted_by_user_id = ?,
                accepted_by_role = ?,
                is_optional_acceptance = 0,
                time_started = datetime('now'),
                updated_at = ?
          WHERE id = ? AND status = 'approved'`,
      )
      .bind(user.id, userRole, now, id);
  }

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: isOptional ? "accepted_optional" : "accepted",
    note: isOptional ? `Aceptación opcional (original: ${existing.assigned_role})` : null,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya fue aceptada o cambió de estado"), 409);
  }

  return c.json({
    success: true,
    data: { id, status: "accepted", is_optional_acceptance: isOptional ? 1 : 0, time_started: now },
  });
});

// ─── PATCH /:id/start ──────────────────────────────────────────────────────
requestsRouter.patch("/:id/start", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole) return c.json(errBody("FORBIDDEN", "Sin rol asignado"), 403);

  const existing = await db
    .prepare(
      `SELECT id, status, assigned_role, accepted_by_user_id
         FROM requests WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      status: string;
      assigned_role: string;
      accepted_by_user_id: string | null;
    }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "accepted") {
    return c.json(
      errBody("INVALID_STATE", `Solo se puede iniciar desde 'accepted' (actual: ${existing.status})`),
      409,
    );
  }

  // Quien arranca debe ser el aceptante o pertenecer al rol asignado actual.
  const isAcceptingUser = existing.accepted_by_user_id === user.id;
  const isAssignedRole =
    existing.assigned_role === userRole || existing.assigned_role === "all";
  if (!isAcceptingUser && !isAssignedRole && !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "No sos el aceptante ni pertenecés al rol asignado"), 403);
  }

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  const updateStmt = db
    .prepare(
      `UPDATE requests SET status = 'in_progress', time_started = datetime('now'), updated_at = ?
         WHERE id = ? AND status = 'accepted'`,
    )
    .bind(now, id);

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "started",
    note: null,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "in_progress", updated_at: now } });
});

// ─── PATCH /:id/complete ───────────────────────────────────────────────────
requestsRouter.patch("/:id/complete", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  let body: { cost_spent?: number | null; incidents?: string | null } = {};
  try {
    body = await c.req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  // Validar cost_spent
  let costSpent: number | null = null;
  if (body.cost_spent !== undefined && body.cost_spent !== null) {
    const cost = Number(body.cost_spent);
    if (!Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
      return c.json(
        errBody("VALIDATION_ERROR", `cost_spent debe ser un número finito entre 0 y ${MAX_COST}`),
        400,
      );
    }
    costSpent = cost;
  }
  // Validar incidents
  let incidents: string | null = null;
  if (body.incidents !== undefined && body.incidents !== null) {
    if (typeof body.incidents !== "string") {
      return c.json(errBody("VALIDATION_ERROR", "incidents debe ser string"), 400);
    }
    if (body.incidents.length > MAX_INCIDENTS_LEN) {
      return c.json(
        errBody("VALIDATION_ERROR", `incidents no puede exceder ${MAX_INCIDENTS_LEN} caracteres`),
        400,
      );
    }
    incidents = body.incidents;
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole) return c.json(errBody("FORBIDDEN", "Sin rol asignado"), 403);

  const existing = await db
    .prepare(
      `SELECT id, status, assigned_role, accepted_by_user_id, time_started
         FROM requests WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      status: string;
      assigned_role: string;
      accepted_by_user_id: string | null;
      time_started: string | null;
    }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "in_progress" && existing.status !== "accepted") {
    return c.json(
      errBody(
        "INVALID_STATE",
        `Solo se puede completar desde 'in_progress' o 'accepted' (actual: ${existing.status})`,
      ),
      409,
    );
  }
  // Completar desde 'accepted' sin pasar por /start es intencional para tareas simples.
  // duration_minutes usa time_started seteado en /accept o reseteado en /start.

  // Solo quien aceptó (user_id) o alguien del mismo rol aceptante puede completar.
  // Admins también.
  const isAcceptingUser = existing.accepted_by_user_id === user.id;
  const isAssignedRole =
    existing.assigned_role === userRole || existing.assigned_role === "all";
  if (!isAcceptingUser && !isAssignedRole && !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "No tenés permisos para completar esta solicitud"), 403);
  }

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  // duration_minutes se calcula vía SQL para usar julianday() de SQLite directamente
  // y evitar discrepancias de zona horaria entre cliente/servidor.
  // Si time_started es NULL (edge: accepted que nunca se inició y se completa
  // directo), duration queda NULL.
  const updateStmt = db
    .prepare(
      `UPDATE requests
          SET status = 'completed',
              cost_spent = ?,
              incidents = ?,
              time_completed = datetime('now'),
              duration_minutes = CASE
                WHEN time_started IS NOT NULL
                  THEN MAX(0, CAST(ROUND((julianday('now') - julianday(time_started)) * 1440) AS INTEGER))
                ELSE NULL
              END,
              updated_at = ?
        WHERE id = ? AND status IN ('in_progress', 'accepted')`,
    )
    .bind(costSpent, incidents, now, id);

  const noteParts: string[] = [];
  if (costSpent !== null) noteParts.push(`Costo: $${costSpent}`);
  if (incidents) noteParts.push(`Incidentes: ${incidents}`);
  const note = noteParts.length > 0 ? noteParts.join(" | ") : null;

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "completed",
    note,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  // Devolvemos los campos calculados leyéndolos.
  const updated = await db
    .prepare(
      `SELECT status, time_completed, duration_minutes, cost_spent, incidents
         FROM requests WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<RequestRow>();
  if (!updated) return c.json({ success: true, data: { id } });
  return c.json({ success: true, data: { id, ...updated } });
});

// ─── PATCH /:id/reassign-request ───────────────────────────────────────────
// "Arrepentido": el aceptante pide que lo saquen de la solicitud.
requestsRouter.patch("/:id/reassign-request", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  let body: { reassignment_note?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(errBody("VALIDATION_ERROR", "Body JSON inválido"), 400);
  }
  const note = typeof body.reassignment_note === "string" ? body.reassignment_note.trim() : "";
  if (note.length < MIN_REASSIGNMENT_NOTE_LEN) {
    return c.json(
      errBody(
        "VALIDATION_ERROR",
        `reassignment_note es requerido (mínimo ${MIN_REASSIGNMENT_NOTE_LEN} caracteres)`,
      ),
      400,
    );
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole) return c.json(errBody("FORBIDDEN", "Sin rol asignado"), 403);

  const existing = await db
    .prepare(
      `SELECT id, status, accepted_by_user_id FROM requests WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; status: string; accepted_by_user_id: string | null }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "accepted" && existing.status !== "in_progress") {
    return c.json(
      errBody(
        "INVALID_STATE",
        `Solo se puede pedir reasignación desde 'accepted' o 'in_progress' (actual: ${existing.status})`,
      ),
      409,
    );
  }
  if (existing.accepted_by_user_id !== user.id && !ADMIN_ROLES.has(userRole)) {
    return c.json(
      errBody("FORBIDDEN", "Solo el aceptante puede pedir reasignación"),
      403,
    );
  }

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  const updateStmt = db
    .prepare(
      `UPDATE requests
          SET status = 'reassignment_requested',
              reassignment_note = ?,
              updated_at = ?
        WHERE id = ? AND status IN ('accepted', 'in_progress')`,
    )
    .bind(note, now, id);

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "reassignment_requested",
    note,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "reassignment_requested", updated_at: now } });
});

// ─── PATCH /:id/reassign-approve ───────────────────────────────────────────
// Admin aprueba el arrepentido → vuelve a approved limpiando aceptante.
requestsRouter.patch("/:id/reassign-approve", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo administradores pueden aprobar reasignaciones"), 403);
  }

  const existing = await db
    .prepare(
      `SELECT id, status, is_optional_acceptance, original_assigned_role, assigned_role
         FROM requests WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      status: string;
      is_optional_acceptance: number;
      original_assigned_role: string | null;
      assigned_role: string;
    }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status !== "reassignment_requested") {
    return c.json(
      errBody(
        "INVALID_STATE",
        `Solo se puede aprobar reasignación desde 'reassignment_requested' (actual: ${existing.status})`,
      ),
      409,
    );
  }

  // Si la aceptación fue opcional, restauramos el rol original.
  // Si no, dejamos assigned_role como estaba.
  const restoredRole =
    existing.is_optional_acceptance === 1 && existing.original_assigned_role
      ? existing.original_assigned_role
      : existing.assigned_role;

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  const updateStmt = db
    .prepare(
      `UPDATE requests
          SET status = 'approved',
              accepted_by_user_id = NULL,
              accepted_by_role = NULL,
              is_optional_acceptance = 0,
              original_assigned_role = NULL,
              assigned_role = ?,
              time_started = NULL,
              updated_at = ?
        WHERE id = ? AND status = 'reassignment_requested'`,
    )
    .bind(restoredRole, now, id);

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "reassignment_approved",
    note: `Restaurado a rol: ${restoredRole}`,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  return c.json({
    success: true,
    data: { id, status: "approved", assigned_role: restoredRole, updated_at: now },
  });
});

// ─── DELETE /:id (soft cancel) ─────────────────────────────────────────────
requestsRouter.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as string | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo administradores pueden cancelar solicitudes"), 403);
  }

  const existing = await db
    .prepare("SELECT id, status FROM requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Solicitud no encontrada"), 404);
  if (existing.status === "cancelled") {
    return c.json(errBody("CONFLICT", "La solicitud ya está cancelada"), 409);
  }
  if (existing.status === "completed") {
    return c.json(errBody("CONFLICT", "No se puede cancelar una solicitud completada"), 409);
  }

  const userInfo = await fetchUserName(db, user.id);
  const now = nowSqliteTs();

  const updateStmt = db
    .prepare(
      `UPDATE requests SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND status NOT IN ('cancelled', 'completed')`,
    )
    .bind(now, id);

  const activityStmt = buildActivityInsert(db, {
    requestId: id,
    userId: user.id,
    userRole,
    userName: userInfo?.name ?? null,
    action: "cancelled",
    note: null,
  });

  const [updateResult] = await db.batch([updateStmt, activityStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "La solicitud ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "cancelled", updated_at: now } });
});
