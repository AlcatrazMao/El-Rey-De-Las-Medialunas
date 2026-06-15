import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const auditRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / — paginated audit log with filters
auditRoutes.get("/", async (c) => {
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

  let query = `
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (userId) { query += " AND al.user_id = ?"; bindings.push(userId); }
  if (entityType) { query += " AND al.entity_type = ?"; bindings.push(entityType); }
  if (entityId) { query += " AND al.entity_id = ?"; bindings.push(entityId); }
  if (action) { query += " AND al.action LIKE ?"; bindings.push(`%${action}%`); }
  if (fromDate) { query += " AND al.created_at >= ?"; bindings.push(`${fromDate} 00:00:00`); }
  if (toDate) { query += " AND al.created_at <= ?"; bindings.push(`${toDate} 23:59:59`); }

  const countQuery = query.replace(
    /SELECT al\.\*.*?FROM audit_log al/s,
    "SELECT COUNT(*) as total FROM audit_log al"
  );

  const [results, countRow] = await Promise.all([
    db.prepare(`${query} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`)
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
