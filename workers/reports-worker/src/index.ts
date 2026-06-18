/**
 * Reports Worker — Queue consumer for report-generation queue
 * Generates heavy reports asynchronously and caches results in D1.
 */

interface Env {
  DB: D1Database;
}

type ReportType =
  | "daily_sales"
  | "inventory_status"
  | "cash_session_summary"
  | "top_products";

interface ReportPayload {
  report_type: ReportType;
  branch_id: string;
  date_from?: string;
  date_to?: string;
  user_id?: string;
}

interface QueueMessage {
  type: "report_generation";
  payload: ReportPayload;
  timestamp: string;
  branch_id: string;
  user_id?: string;
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS report_results (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  date_from TEXT,
  date_to TEXT,
  generated_at TEXT NOT NULL,
  generated_by TEXT,
  data TEXT NOT NULL
)
`;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runReportQuery(
  db: D1Database,
  payload: ReportPayload,
  dateFrom: string,
  dateTo: string,
): Promise<unknown[]> {
  switch (payload.report_type) {
    case "daily_sales": {
      const result = await db
        .prepare(
          `SELECT
            DATE(created_at) as date,
            COUNT(*) as total_sales,
            SUM(total) as revenue,
            SUM(tax_total) as taxes,
            SUM(discount_total) as discounts,
            COUNT(CASE WHEN status = 'voided' THEN 1 END) as voided_count
          FROM sales
          WHERE branch_id = ?
            AND status != 'voided'
            AND DATE(created_at) BETWEEN ? AND ?
          GROUP BY DATE(created_at)
          ORDER BY date DESC`,
        )
        .bind(payload.branch_id, dateFrom, dateTo)
        .all();
      return result.results ?? [];
    }
    case "inventory_status": {
      const result = await db
        .prepare(
          `SELECT
            p.id, p.name, p.code,
            COALESCE(i.quantity, 0) as current_stock,
            p.min_stock,
            CASE WHEN COALESCE(i.quantity, 0) <= p.min_stock THEN 1 ELSE 0 END as is_low_stock,
            p.cost,
            COALESCE(i.quantity, 0) * p.cost as stock_value
          FROM products p
          LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = ?
          WHERE p.branch_id = ? AND p.is_active = 1 AND p.track_inventory = 1
          ORDER BY is_low_stock DESC, p.name ASC`,
        )
        .bind(payload.branch_id, payload.branch_id)
        .all();
      return result.results ?? [];
    }
    case "cash_session_summary": {
      const result = await db
        .prepare(
          `SELECT
            cs.id, cs.opening_amount, cs.closing_amount,
            cs.opened_at, cs.closed_at,
            cs.status,
            COUNT(s.id) as sale_count,
            COALESCE(SUM(s.total), 0) as total_sales
          FROM cash_sessions cs
          LEFT JOIN sales s ON s.branch_id = cs.branch_id
            AND s.created_at BETWEEN cs.opened_at AND COALESCE(cs.closed_at, datetime('now'))
            AND s.status = 'completed'
          WHERE cs.branch_id = ?
            AND DATE(cs.opened_at) BETWEEN ? AND ?
          GROUP BY cs.id
          ORDER BY cs.opened_at DESC`,
        )
        .bind(payload.branch_id, dateFrom, dateTo)
        .all();
      return result.results ?? [];
    }
    case "top_products": {
      const result = await db
        .prepare(
          `SELECT
            p.id, p.name, p.code,
            SUM(si.quantity) as units_sold,
            SUM(si.total) as revenue,
            COUNT(DISTINCT si.sale_id) as sale_count
          FROM sale_items si
          JOIN products p ON p.id = si.product_id
          JOIN sales s ON s.id = si.sale_id
          WHERE s.branch_id = ?
            AND s.status = 'completed'
            AND DATE(s.created_at) BETWEEN ? AND ?
          GROUP BY p.id
          ORDER BY revenue DESC
          LIMIT 20`,
        )
        .bind(payload.branch_id, dateFrom, dateTo)
        .all();
      return result.results ?? [];
    }
    default: {
      const exhaustive: never = payload.report_type;
      throw new Error(`Unsupported report_type: ${String(exhaustive)}`);
    }
  }
}

async function handleReport(
  payload: ReportPayload,
  db: D1Database,
  userId?: string,
): Promise<void> {
  await db.prepare(CREATE_TABLE_SQL).run();

  const today = todayIso();
  const dateFrom = payload.date_from ?? today;
  const dateTo = payload.date_to ?? today;

  const results = await runReportQuery(db, payload, dateFrom, dateTo);

  const reportId = `${payload.report_type}:${payload.branch_id}:${dateFrom}:${dateTo}`;
  const generatedBy = payload.user_id ?? userId ?? null;

  await db
    .prepare(
      `INSERT INTO report_results (id, report_type, branch_id, date_from, date_to, generated_at, generated_by, data)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         data = excluded.data,
         generated_at = excluded.generated_at,
         generated_by = excluded.generated_by`,
    )
    .bind(
      reportId,
      payload.report_type,
      payload.branch_id,
      dateFrom,
      dateTo,
      generatedBy,
      JSON.stringify(results),
    )
    .run();
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleReport(
          message.body.payload,
          env.DB,
          message.body.user_id,
        );
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;
