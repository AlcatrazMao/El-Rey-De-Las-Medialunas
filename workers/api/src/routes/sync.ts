import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// ── PULL — differential sync, server → client ─────────────────────────
// GET /pull?last_sync_timestamp=&branch_id=&entity_types=
syncRoutes.get("/pull", async (c) => {
  const db = c.env.DB;
  const rawBranchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const rawSince = c.req.query("last_sync_timestamp") ?? "";

  // Bug 1 — CRITICAL: validate inputs before using in queries
  const BRANCH_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!BRANCH_RE.test(rawBranchId)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "branch_id inválido" } }, 400);
  }
  if (rawSince !== "" && !ISO_RE.test(rawSince)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "last_sync_timestamp inválido" } }, 400);
  }

  const branchId = rawBranchId;
  const since = rawSince !== "" ? rawSince : "1970-01-01 00:00:00";
  const requestedTypes = c.req.query("entity_types")?.split(",").filter(Boolean);

  const serverTimestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Bug 1 — CRITICAL: use prepared statements with ? placeholders
  const PULLABLE: { type: string; query: string; bindings: unknown[] }[] = [
    {
      type: "products",
      query: `SELECT * FROM products WHERE branch_id = ? AND updated_at > ?`,
      bindings: [branchId, since],
    },
    {
      type: "categories",
      query: `SELECT * FROM categories WHERE branch_id = ? AND updated_at > ?`,
      bindings: [branchId, since],
    },
    {
      type: "inventory",
      query: `SELECT i.*, p.name as product_name FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.branch_id = ? AND i.updated_at > ?`,
      bindings: [branchId, since],
    },
    {
      type: "customers",
      query: `SELECT * FROM customers WHERE updated_at > ?`,
      bindings: [since],
    },
    {
      type: "sales",
      query: `SELECT * FROM sales WHERE branch_id = ? AND created_at > ?`,
      bindings: [branchId, since],
    },
    {
      type: "batches",
      query: `SELECT ib.*, p.name as product_name FROM inventory_batches ib LEFT JOIN products p ON p.id = ib.product_id WHERE ib.branch_id = ? AND ib.created_at > ?`,
      bindings: [branchId, since],
    },
    {
      type: "offers",
      query: `SELECT * FROM offers WHERE branch_id = ? AND updated_at > ?`,
      bindings: [branchId, since],
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

  for (const { type, query, bindings } of activePullable) {
    const stmt = db.prepare(query).bind(...bindings);
    const results = await stmt.all<Record<string, unknown>>();
    for (const row of results.results ?? []) {
      const entityId = String(row.id ?? "");
      const isDeleted = row.deleted_at != null;
      // Bug 5 — LOW: use "upsert" for live rows, "delete" for soft-deleted
      operations.push({
        id: `${type}_${entityId}_${serverTimestamp}`,
        entity_type: type,
        operation: isDeleted ? "delete" : "upsert",
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

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const operations = body.operations ?? [];

  // SECURITY: cap the batch size to prevent a single client from queueing
  // thousands of statements against D1 in one request (DoS surface and
  // D1 batch limit of ~100 statements). Clients should chunk pushes.
  const MAX_OPERATIONS_PER_PUSH = 200;
  if (operations.length > MAX_OPERATIONS_PER_PUSH) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Demasiadas operaciones en una sola sincronización (máx ${MAX_OPERATIONS_PER_PUSH})`,
        },
      },
      400,
    );
  }
  let processed = 0;
  let failed = 0;
  // Bug 4 — MEDIUM: collect error details so the client knows what failed
  const errors: string[] = [];

  for (const op of operations) {
    try {
      await applyOperation(db, op, user.id, branchId);
      processed++;
    } catch (e) {
      failed++;
      // SECURITY: do not echo internal error messages back to the client —
      // they can include SQL errors with column names. Log server-side
      // and report a stable code to the client.
      console.error(`[sync/push] op ${op.client_id} (${op.entity_type}) failed:`, e);
      errors.push(`${op.client_id}: APPLY_FAILED`);
    }
  }

  return c.json({ success: true, data: { processed, failed, errors } });
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
      const discountTotal = Number(d.discount_total ?? 0);
      const taxTotal = Number(d.tax_total ?? 0);
      const total = Number(d.total ?? subtotal + taxTotal);

      await db.prepare(
        `INSERT OR IGNORE INTO sales (id, branch_id, user_id, customer_id, sale_number, subtotal, discount_total, tax_total, total, status, sync_status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'synced', ?, ?)`
      ).bind(id, branchId, userId, d.customer_id ?? null, saleNumber, subtotal, discountTotal, taxTotal, total, d.notes ?? null, now).run();

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

    case "batch": {
      // Bug 2 — HIGH: INSERT OR REPLACE destroys FKs; split by operation instead
      if (op.operation === "create") {
        await db.prepare(
          `INSERT OR IGNORE INTO inventory_batches
            (id, product_id, branch_id, batch_number, entry_date, expiry_date, durability_days,
             cost_per_unit, initial_quantity, remaining_quantity, inventory_method, status, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          String(d.product_id ?? ""),
          branchId,
          String(d.batch_number ?? ""),
          String(d.entry_date ?? now.slice(0, 10)),
          d.expiry_date == null ? null : String(d.expiry_date),
          d.durability_days == null ? null : Number(d.durability_days),
          Number(d.cost_per_unit ?? 0),
          Number(d.initial_quantity ?? 0),
          Number(d.remaining_quantity ?? d.initial_quantity ?? 0),
          String(d.inventory_method ?? "FIFO"),
          String(d.status ?? "active"),
          d.notes == null ? null : String(d.notes),
          String(d.created_at ?? now),
        ).run();
      } else if (op.operation === "update") {
        await db.prepare(
          `UPDATE inventory_batches
           SET product_id = ?, branch_id = ?, batch_number = ?, entry_date = ?, expiry_date = ?,
               durability_days = ?, cost_per_unit = ?, initial_quantity = ?, remaining_quantity = ?,
               inventory_method = ?, status = ?, notes = ?
           WHERE id = ?`
        ).bind(
          String(d.product_id ?? ""),
          branchId,
          String(d.batch_number ?? ""),
          String(d.entry_date ?? now.slice(0, 10)),
          d.expiry_date == null ? null : String(d.expiry_date),
          d.durability_days == null ? null : Number(d.durability_days),
          Number(d.cost_per_unit ?? 0),
          Number(d.initial_quantity ?? 0),
          Number(d.remaining_quantity ?? d.initial_quantity ?? 0),
          String(d.inventory_method ?? "FIFO"),
          String(d.status ?? "active"),
          d.notes == null ? null : String(d.notes),
          id,
        ).run();
      }
      break;
    }

    case "offer": {
      const batchIds = Array.isArray(d.batch_ids)
        ? JSON.stringify(d.batch_ids)
        : typeof d.batch_ids === "string"
          ? d.batch_ids
          : "[]";
      const productIds = Array.isArray(d.product_ids)
        ? JSON.stringify(d.product_ids)
        : typeof d.product_ids === "string"
          ? d.product_ids
          : "[]";
      // Bug 3 — HIGH: INSERT OR IGNORE silences updates; split by operation
      if (op.operation === "create") {
        await db.prepare(
          `INSERT OR IGNORE INTO offers
            (id, branch_id, user_id, name, discount_percent, batch_ids, product_ids,
             starts_at, ends_at, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          branchId,
          userId,
          String(d.name ?? ""),
          Number(d.discount_percent ?? 0),
          batchIds,
          productIds,
          String(d.starts_at ?? now),
          d.ends_at == null ? null : String(d.ends_at),
          String(d.status ?? "active"),
          d.notes == null ? null : String(d.notes),
          now,
          now,
        ).run();
      } else if (op.operation === "update") {
        await db.prepare(
          `UPDATE offers
           SET name = ?, discount_percent = ?, batch_ids = ?, product_ids = ?,
               starts_at = ?, ends_at = ?, status = ?, notes = ?, updated_at = ?
           WHERE id = ?`
        ).bind(
          String(d.name ?? ""),
          Number(d.discount_percent ?? 0),
          batchIds,
          productIds,
          String(d.starts_at ?? now),
          d.ends_at == null ? null : String(d.ends_at),
          String(d.status ?? "active"),
          d.notes == null ? null : String(d.notes),
          now,
          id,
        ).run();
      }
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

