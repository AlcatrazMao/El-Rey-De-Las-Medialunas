import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// ── PULL — differential sync, server → client ─────────────────────────
// GET /pull?last_sync_timestamp=&branch_id=&entity_types=
syncRoutes.get("/pull", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const since = c.req.query("last_sync_timestamp") ?? "1970-01-01 00:00:00";
  const requestedTypes = c.req.query("entity_types")?.split(",").filter(Boolean);

  const serverTimestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Define which tables to pull and how to map them
  const PULLABLE: { type: string; query: string }[] = [
    {
      type: "products",
      query: `SELECT * FROM products WHERE branch_id = '${branchId}' AND updated_at > '${since}'`,
    },
    {
      type: "categories",
      query: `SELECT * FROM categories WHERE branch_id = '${branchId}' AND updated_at > '${since}'`,
    },
    {
      type: "inventory",
      query: `SELECT i.*, p.name as product_name FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.branch_id = '${branchId}' AND i.updated_at > '${since}'`,
    },
    {
      type: "customers",
      query: `SELECT * FROM customers WHERE updated_at > '${since}'`,
    },
    {
      type: "sales",
      query: `SELECT * FROM sales WHERE branch_id = '${branchId}' AND created_at > '${since}'`,
    },
  ];

  const activePullable = requestedTypes
    ? PULLABLE.filter(p => requestedTypes.includes(p.type))
    : PULLABLE;

  const operations: {
    id: string;
    entity_type: string;
    operation: string;
    entity_id: string;
    data: Record<string, unknown>;
    server_timestamp: string;
  }[] = [];

  for (const { type, query } of activePullable) {
    const results = await db.prepare(query).all<Record<string, unknown>>();
    for (const row of results.results ?? []) {
      const entityId = String(row.id ?? "");
      const isDeleted = row.deleted_at != null;
      operations.push({
        id: `${type}_${entityId}_${serverTimestamp}`,
        entity_type: type,
        operation: isDeleted ? "delete" : "create",
        entity_id: entityId,
        data: row,
        server_timestamp: String(row.updated_at ?? serverTimestamp),
      });
    }
  }

  return c.json({
    success: true,
    data: { operations, server_timestamp: serverTimestamp },
  });
});

// ── PUSH — client → server, apply queued operations ───────────────────
// POST /push  body: { operations: [...], branch_id }
syncRoutes.post("/push", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    operations: {
      client_id: string;
      entity_type: string;
      operation: "create" | "update" | "delete";
      data: Record<string, unknown>;
      client_timestamp: string;
    }[];
    branch_id?: string;
  }>();

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const operations = body.operations ?? [];
  let processed = 0;
  let failed = 0;

  for (const op of operations) {
    try {
      await applyOperation(db, op, user.id, branchId);
      processed++;
    } catch {
      failed++;
    }
  }

  return c.json({ success: true, data: { processed, failed } });
});

// ── Operation dispatcher ───────────────────────────────────────────────

async function applyOperation(
  db: D1Database,
  op: {
    client_id: string;
    entity_type: string;
    operation: "create" | "update" | "delete";
    data: Record<string, unknown>;
    client_timestamp: string;
  },
  userId: string,
  branchId: string,
): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const id = String(op.data.id ?? op.client_id);
  const d = op.data;

  switch (op.entity_type) {
    case "sale": {
      if (op.operation !== "create") break;
      const saleNumberRow = await db
        .prepare("SELECT COALESCE(MAX(sale_number), 0) + 1 AS next_number FROM sales WHERE branch_id = ?")
        .bind(branchId)
        .first<{ next_number: number }>();
      const saleNumber = saleNumberRow?.next_number ?? 1;
      const subtotal = Number(d.subtotal ?? 0);
      const taxTotal = Number(d.tax_total ?? 0);
      const total = Number(d.total ?? subtotal + taxTotal);

      await db.prepare(
        `INSERT OR IGNORE INTO sales (id, branch_id, user_id, customer_id, sale_number, subtotal, tax_total, total, status, sync_status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'synced', ?, ?)`
      ).bind(id, branchId, userId, d.customer_id ?? null, saleNumber, subtotal, taxTotal, total, d.notes ?? null, now).run();

      const items = Array.isArray(d.items) ? d.items as Record<string, unknown>[] : [];
      const payments = Array.isArray(d.payments) ? d.payments as Record<string, unknown>[] : [];

      const itemStmts = items.flatMap(item => {
        const itemId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
        const movId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
        const qty = Number(item.quantity ?? 0);
        const price = Number(item.unit_price ?? 0);
        return [
          db.prepare(
            `INSERT OR IGNORE INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, tax_rate, tax_amount, total, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(itemId, id, String(item.product_id ?? ""), qty, price, 0, Number(item.tax_rate ?? 0), Number(item.tax_amount ?? 0), qty * price, now),
          db.prepare(
            `INSERT OR IGNORE INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
             VALUES (?, ?, ?, 'sale_out', ?, 'Venta sync offline', ?, ?)`
          ).bind(movId, String(item.product_id ?? ""), branchId, qty, userId, now),
          db.prepare(
            `UPDATE inventory SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
             WHERE product_id = ? AND branch_id = ?`
          ).bind(qty, now, String(item.product_id ?? ""), branchId),
        ];
      });

      const paymentStmts = payments.map(pay => {
        const payId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
        return db.prepare(
          `INSERT OR IGNORE INTO sale_payments (id, sale_id, payment_method, amount, created_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(payId, id, String(pay.payment_method ?? "cash"), Number(pay.amount ?? 0), now);
      });

      if (itemStmts.length + paymentStmts.length > 0) await db.batch([...itemStmts, ...paymentStmts]);
      break;
    }

    case "void_sale": {
      await db.prepare(
        `UPDATE sales SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, sync_status = 'synced' WHERE id = ? AND status = 'completed'`
      ).bind(now, userId, String(d.void_reason ?? ""), id).run();
      break;
    }

    case "expense": {
      if (op.operation !== "create") break;
      await db.prepare(
        `INSERT OR IGNORE INTO expenses (id, branch_id, user_id, concept, category, amount, payment_method, invoice_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, branchId, userId, String(d.concept ?? ""), String(d.category ?? "otros"), Number(d.amount ?? 0), String(d.payment_method ?? "cash"), d.invoice_url ?? null, now).run();
      break;
    }

    case "customer": {
      if (op.operation === "delete") break;
      await db.prepare(
        `INSERT OR IGNORE INTO customers (id, name, email, phone, type, credit_limit, current_debt, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      ).bind(id, String(d.name ?? ""), d.email ?? null, d.phone ?? null, String(d.type ?? "consumer"), Number(d.credit_limit ?? 0), now, now).run();
      break;
    }

    case "cash_session": {
      if (op.operation !== "create") break;
      await db.prepare(
        `INSERT OR IGNORE INTO cash_sessions (id, branch_id, user_id, opening_amount, notes, opened_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, branchId, userId, Number(d.opening_amount ?? 0), d.notes ?? null, String(d.opened_at ?? now)).run();
      break;
    }

    case "supply_request": {
      if (op.operation !== "create") break;
      await db.prepare(
        `INSERT OR IGNORE INTO supply_requests (id, branch_id, user_id, type, item_id, item_name, quantity, unit, reason, requested_by, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(id, branchId, userId, String(d.type ?? "product"), String(d.item_id ?? ""), String(d.item_name ?? ""), Number(d.quantity ?? 0), String(d.unit ?? ""), d.reason ?? null, String(d.requested_by ?? ""), now, now).run();
      break;
    }

    case "close_session": {
      const closingAmount = Number(d.closing_amount ?? 0);
      const expectedAmount = Number(d.expected_amount ?? closingAmount);
      const difference = closingAmount - expectedAmount;
      await db.prepare(
        `UPDATE cash_sessions
         SET status = 'closed', closing_amount = ?, expected_amount = ?, difference = ?,
             notes = COALESCE(?, notes), closed_at = ?
         WHERE id = ? AND status != 'closed'`
      ).bind(closingAmount, expectedAmount, difference, d.notes ?? null, now, id).run();
      break;
    }

    default:
      throw new Error(`Unknown entity_type: ${op.entity_type}`);
  }
}

