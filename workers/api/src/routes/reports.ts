import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const reportRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

function dateRange(c: { req: { query: (k: string) => string | undefined } }) {
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const from = c.req.query("from_date") ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = c.req.query("to_date") ?? new Date().toISOString().slice(0, 10);
  return { branchId, from: `${from} 00:00:00`, to: `${to} 23:59:59` };
}

// GET /sales/summary
reportRoutes.get("/sales/summary", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ver reportes" } }, 403);
  }

  const db = c.env.DB;
  const { branchId, from, to } = dateRange(c);

  const [summary, byPayment] = await Promise.all([
    db.prepare(
      `SELECT
         COUNT(*) as total_sales,
         COALESCE(SUM(total), 0) as total_revenue,
         COALESCE(SUM(tax_total), 0) as total_tax,
         COALESCE(SUM(subtotal), 0) as total_subtotal,
         COALESCE(SUM(discount_total), 0) as total_discounts,
         COALESCE(AVG(total), 0) as average_ticket,
         COUNT(CASE WHEN status = 'voided' THEN 1 END) as total_voided
       FROM sales
       WHERE branch_id = ? AND created_at BETWEEN ? AND ? AND status != 'voided'`
    ).bind(branchId, from, to).first(),

    db.prepare(
      `SELECT sp.payment_method, COUNT(*) as count, COALESCE(SUM(sp.amount), 0) as total
       FROM sale_payments sp
       INNER JOIN sales s ON s.id = sp.sale_id
       WHERE s.branch_id = ? AND s.created_at BETWEEN ? AND ? AND s.status != 'voided'
       GROUP BY sp.payment_method ORDER BY total DESC`
    ).bind(branchId, from, to).all(),
  ]);

  return c.json({
    success: true,
    data: {
      period: { from, to },
      ...summary,
      by_payment_method: byPayment.results ?? [],
    },
  });
});

// GET /sales/by-hour
reportRoutes.get("/sales/by-hour", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ver reportes" } }, 403);
  }

  const db = c.env.DB;
  const { branchId, from, to } = dateRange(c);

  const results = await db.prepare(
    `SELECT
       CAST(strftime('%H', created_at) AS INTEGER) as hour,
       COUNT(*) as count,
       COALESCE(SUM(total), 0) as revenue,
       COALESCE(AVG(total), 0) as average_ticket
     FROM sales
     WHERE branch_id = ? AND created_at BETWEEN ? AND ? AND status != 'voided'
     GROUP BY hour ORDER BY hour ASC`
  ).bind(branchId, from, to).all();

  // Fill missing hours with zeroes
  const rows = (results.results ?? []) as { hour: number; count: number; revenue: number; average_ticket: number }[];
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const found = rows.find(r => r.hour === h);
    return found ?? { hour: h, count: 0, revenue: 0, average_ticket: 0 };
  });

  return c.json({ success: true, data: byHour });
});

// GET /sales/by-product
reportRoutes.get("/sales/by-product", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ver reportes" } }, 403);
  }

  const db = c.env.DB;
  const { branchId, from, to } = dateRange(c);
  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 20 : rawLimit, 1), 100);

  const results = await db.prepare(
    `SELECT
       si.product_id,
       p.name as product_name,
       p.code as product_code,
       COALESCE(SUM(si.quantity), 0) as total_quantity,
       COALESCE(SUM(si.total), 0) as total_revenue,
       COALESCE(AVG(si.unit_price), 0) as average_price,
       COUNT(DISTINCT si.sale_id) as sale_count
     FROM sale_items si
     INNER JOIN sales s ON s.id = si.sale_id
     LEFT JOIN products p ON p.id = si.product_id
     WHERE s.branch_id = ? AND s.created_at BETWEEN ? AND ? AND s.status != 'voided'
     GROUP BY si.product_id
     ORDER BY total_revenue DESC
     LIMIT ?`
  ).bind(branchId, from, to, limit).all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /sales/by-category
reportRoutes.get("/sales/by-category", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ver reportes" } }, 403);
  }

  const db = c.env.DB;
  const { branchId, from, to } = dateRange(c);

  const results = await db.prepare(
    `SELECT
       p.category_id,
       cat.name as category_name,
       COALESCE(SUM(si.quantity), 0) as total_quantity,
       COALESCE(SUM(si.total), 0) as total_revenue,
       COUNT(DISTINCT si.sale_id) as sale_count
     FROM sale_items si
     INNER JOIN sales s ON s.id = si.sale_id
     LEFT JOIN products p ON p.id = si.product_id
     LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE s.branch_id = ? AND s.created_at BETWEEN ? AND ? AND s.status != 'voided'
     GROUP BY p.category_id
     ORDER BY total_revenue DESC`
  ).bind(branchId, from, to).all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /inventory/valuation
reportRoutes.get("/inventory/valuation", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ver reportes" } }, 403);
  }

  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;

  const [valuation, summary] = await Promise.all([
    db.prepare(
      `SELECT
         i.product_id,
         p.name as product_name,
         p.code as product_code,
         p.unit,
         p.cost as unit_cost,
         i.current_quantity,
         COALESCE(i.current_quantity * p.cost, 0) as total_value,
         p.min_stock,
         CASE WHEN i.current_quantity <= p.min_stock THEN 1 ELSE 0 END as is_low_stock
       FROM inventory i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.branch_id = ? AND p.deleted_at IS NULL AND p.is_active = 1
       ORDER BY total_value DESC`
    ).bind(branchId).all(),

    db.prepare(
      `SELECT
         COUNT(*) as total_products,
         COALESCE(SUM(i.current_quantity * p.cost), 0) as total_value,
         COUNT(CASE WHEN i.current_quantity <= p.min_stock THEN 1 END) as low_stock_count,
         COUNT(CASE WHEN i.current_quantity = 0 THEN 1 END) as out_of_stock_count
       FROM inventory i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.branch_id = ? AND p.deleted_at IS NULL AND p.is_active = 1`
    ).bind(branchId).first(),
  ]);

  return c.json({
    success: true,
    data: {
      summary,
      items: valuation.results ?? [],
    },
  });
});

// GET /cash/summary
reportRoutes.get("/cash/summary", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para ver reportes" } }, 403);
  }

  const db = c.env.DB;
  const { branchId, from, to } = dateRange(c);

  const [sessions, summary] = await Promise.all([
    db.prepare(
      `SELECT cs.*, u.name as user_name
       FROM cash_sessions cs
       LEFT JOIN users u ON u.id = cs.user_id
       WHERE cs.branch_id = ? AND cs.opened_at BETWEEN ? AND ?
       ORDER BY cs.opened_at DESC`
    ).bind(branchId, from, to).all(),

    db.prepare(
      `SELECT
         COUNT(*) as total_sessions,
         COALESCE(SUM(opening_amount), 0) as total_opening,
         COALESCE(SUM(closing_amount), 0) as total_closing,
         COALESCE(SUM(CASE WHEN difference < 0 THEN difference ELSE 0 END), 0) as total_deficit,
         COALESCE(SUM(CASE WHEN difference > 0 THEN difference ELSE 0 END), 0) as total_surplus
       FROM cash_sessions
       WHERE branch_id = ? AND status = 'closed' AND opened_at BETWEEN ? AND ?`
    ).bind(branchId, from, to).first(),
  ]);

  return c.json({
    success: true,
    data: {
      period: { from, to },
      summary,
      sessions: sessions.results ?? [],
    },
  });
});
