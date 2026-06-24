import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const auditRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / — paginated audit log with filters
// SECURITY: audit log contains user_id, ip_address, user_agent, and entity_ids
// across the whole system. Only admin/owner can read it.
auditRoutes.get("/", async (c) => {
  const role = c.get("userRole");
  if (role !== "admin" && role !== "owner") {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Solo administradores pueden ver el log de auditoría" } },
      403,
    );
  }

  const db = c.env.DB;
  const userId = c.req.query("user_id");
  const entityType = c.req.query("entity_type");
  const entityId = c.req.query("entity_id");
  const action = c.req.query("action");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(100, parseInt(c.req.query("limit") ?? "50", 10));
  const offset = (page - 1) * limit;

  // Validar formato YYYY-MM-DD para fechas. El log de auditoría usa DATETIME
  // comparisons contra created_at; un string mal formado silenciosamente devuelve
  // resultados vacíos o erróneos en SQLite.
  const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate && !BARE_DATE_RE.test(fromDate)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "from_date debe ser YYYY-MM-DD" } }, 400);
  }
  if (toDate && !BARE_DATE_RE.test(toDate)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "to_date debe ser YYYY-MM-DD" } }, 400);
  }

  // Construimos las condiciones WHERE una sola vez y las reutilizamos para la
  // query principal y la query de count. Evita el regex frágil que rompe el
  // count si alguien edita el SELECT base.
  let whereClause = " WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (userId) { whereClause += " AND al.user_id = ?"; bindings.push(userId); }
  if (entityType) { whereClause += " AND al.entity_type = ?"; bindings.push(entityType); }
  if (entityId) { whereClause += " AND al.entity_id = ?"; bindings.push(entityId); }
  if (action) { whereClause += " AND al.action LIKE ?"; bindings.push(`%${action}%`); }
  if (fromDate) { whereClause += " AND al.created_at >= ?"; bindings.push(`${fromDate} 00:00:00`); }
  if (toDate) { whereClause += " AND al.created_at <= ?"; bindings.push(`${toDate} 23:59:59`); }

  const dataQuery =
    `SELECT al.*, u.name as user_name, u.email as user_email
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.user_id${whereClause}`;

  const countQuery =
    `SELECT COUNT(*) as total
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.user_id${whereClause}`;

  const [results, countRow] = await Promise.all([
    db.prepare(`${dataQuery} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, offset)
      .all(),
    db.prepare(countQuery).bind(...bindings).first<{ total: number }>(),
  ]);

  const total = countRow?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return c.json({
    success: true,
    data: results.results ?? [],
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  });
});
