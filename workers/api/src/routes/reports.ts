import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";

export const reportRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Timezone Argentina (UTC-3). El cliente envía `from_date`/`to_date` ya
// expresados en hora argentina (ej: "2026-06-19"). Internamente la DB guarda
// `created_at` en UTC, así que convertimos el rango argentino a UTC antes de
// querear: medianoche ARG de un día = 03:00:00 UTC del mismo día, y el final
// 23:59:59 ARG = 02:59:59 UTC del día siguiente.

// Validamos el formato YYYY-MM-DD ANTES de concatenar en SQL. Si bien D1 usa
// bindings, un valor mal formado rompe DATETIME() de SQLite y produce 500 o
// resultados silenciosamente incorrectos. Sólo aceptamos fechas calendario.
export const isValidReportDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Retorna la fecha argentina de hoy en formato YYYY-MM-DD usando la API
// estándar Intl — más robusto que un offset hardcodeado, ya que respeta
// correctamente la zona horaria incluso si el runtime tiene un reloj desajustado
// o el código se adapta a otras regiones en el futuro.
// Exportada como función pura para tests unitarios.
export function argToday(): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // es-AR devuelve "DD/MM/YYYY". Invertimos las partes para obtener YYYY-MM-DD.
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Sentinel para diferenciar "no llegó" vs "llegó pero inválido".
const DATE_RANGE_INVALID = Symbol("invalid_date");
type DateRangeInvalid = typeof DATE_RANGE_INVALID;

function dateRange(
  c: { req: { query: (k: string) => string | undefined } }
): { branchId: string; from: string; to: string } | DateRangeInvalid {
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  // Por defecto últimos 30 días en hora ARG. Usamos argToday() para obtener la
  // fecha argentina correcta vía Intl (evita el offset hardcodeado -3h).
  const toDefault = argToday();
  // 30 días atrás: construimos una Date a medianoche UTC del "hoy ARG" y
  // restamos 30 días para no depender del offset hardcodeado.
  const todayUtcMidnight = new Date(`${toDefault}T00:00:00Z`);
  const fromDefault = new Date(todayUtcMidnight.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const fromRaw = c.req.query("from_date");
  const toRaw = c.req.query("to_date");
  // Si el cliente mandó algo, debe cumplir YYYY-MM-DD; de lo contrario, default.
  if (fromRaw !== undefined && !isValidReportDate(fromRaw)) return DATE_RANGE_INVALID;
  if (toRaw !== undefined && !isValidReportDate(toRaw)) return DATE_RANGE_INVALID;
  const from = fromRaw ?? fromDefault;
  const to = toRaw ?? toDefault;
  // ARG midnight (00:00 -03:00) → 03:00 UTC del mismo día.
  // ARG 23:59:59 (-03:00) → 02:59:59 UTC del día siguiente.
  const toDateObj = new Date(`${to}T00:00:00Z`);
  toDateObj.setUTCDate(toDateObj.getUTCDate() + 1);
  const toNextDay = toDateObj.toISOString().slice(0, 10);
  return {
    branchId,
    from: `${from} 03:00:00`,
    to: `${toNextDay} 02:59:59`,
  };
}

function isInvalidDateRange(
  r: { branchId: string; from: string; to: string } | DateRangeInvalid
): r is DateRangeInvalid {
  return r === DATE_RANGE_INVALID;
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
  const range = dateRange(c);
  if (isInvalidDateRange(range)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Formato de fecha inválido" } }, 400);
  }
  const { branchId, from, to } = range;

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
  const range = dateRange(c);
  if (isInvalidDateRange(range)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Formato de fecha inválido" } }, 400);
  }
  const { branchId, from, to } = range;

  // strftime('%H', created_at, '-3 hours') → hora argentina (UTC-3).
  // Sin el offset, una venta hecha a las 22:00 ARG aparecería como hora 1 UTC.
  const results = await db.prepare(
    `SELECT
       CAST(strftime('%H', created_at, '-3 hours') AS INTEGER) as hour,
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
  const range = dateRange(c);
  if (isInvalidDateRange(range)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Formato de fecha inválido" } }, 400);
  }
  const { branchId, from, to } = range;
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
  const range = dateRange(c);
  if (isInvalidDateRange(range)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Formato de fecha inválido" } }, 400);
  }
  const { branchId, from, to } = range;

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
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;

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
  const range = dateRange(c);
  if (isInvalidDateRange(range)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Formato de fecha inválido" } }, 400);
  }
  const { branchId, from, to } = range;

  const [sessions, summary, movementsAgg] = await Promise.all([
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

    // Agregamos movements para que el reporte de tesorería refleje los
    // retiros/depósitos intra-sesión (antes ignorados en el closing esperado).
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN cm.type = 'income' THEN cm.amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN cm.type = 'expense' THEN cm.amount ELSE 0 END), 0) as total_expense,
         COALESCE(SUM(CASE WHEN cm.type = 'adjustment' THEN cm.amount ELSE 0 END), 0) as total_adjustment
       FROM cash_movements cm
       INNER JOIN cash_sessions cs ON cs.id = cm.cash_session_id
       WHERE cs.branch_id = ? AND cs.opened_at BETWEEN ? AND ?`
    ).bind(branchId, from, to).first<{ total_income: number; total_expense: number; total_adjustment: number }>(),
  ]);

  const movementsSummary = movementsAgg ?? { total_income: 0, total_expense: 0, total_adjustment: 0 };
  const movementsNet =
    Number(movementsSummary.total_income ?? 0) -
    Number(movementsSummary.total_expense ?? 0) +
    Number(movementsSummary.total_adjustment ?? 0);
  const summaryWithMovements = {
    ...(summary ?? {}),
    movements_income: movementsSummary.total_income,
    movements_expense: movementsSummary.total_expense,
    movements_adjustment: movementsSummary.total_adjustment,
    movements_net: movementsNet,
  };

  return c.json({
    success: true,
    data: {
      period: { from, to },
      summary: summaryWithMovements,
      sessions: sessions.results ?? [],
    },
  });
});
