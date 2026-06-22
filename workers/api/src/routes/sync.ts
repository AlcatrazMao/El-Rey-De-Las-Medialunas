import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// SECURITY: numeric inputs vienen de la cola offline del cliente y pueden ser
// NaN/Infinity por bugs en serialización (ej. Number(undefined)). Si dejamos
// que lleguen al INSERT, contaminamos totales financieros y stock con valores
// inválidos. assertFinitePositive lanza para abortar la operación.
export function assertFinitePositive(v: unknown, field: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)}`);
  }
  return n;
}

const VOID_ALLOWED_ROLES = new Set(["admin", "owner", "supervisor"]);

// ── PULL — differential sync, server → client ─────────────────────────
// GET /pull?last_sync_timestamp=&branch_id=&entity_types=
syncRoutes.get("/pull", async (c) => {
  const db = c.env.DB;
  const rawBranchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
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

  const serverTimestamp = nowSqliteTs();

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

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const operations = body.operations ?? [];
  const userRole = c.get("userRole") ?? "";

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
      await applyOperation(db, op, user.id, branchId, userRole);
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
  userRole: string,
): Promise<void> {
  const now = nowSqliteTs();
  const id = String(op.data.id ?? op.client_id);
  const d = op.data;

  switch (op.entity_type) {
    case "sale": {
      if (op.operation !== "create") break;

      // BUG FIX C1 — replay doble-descuento:
      // Antes del fix, si bien el chequeo por idempotency_key abortaba el batch,
      // un replay sin idempotency_key (cliente legacy) podía llegar con el mismo
      // `id`. En ese caso el INSERT INTO sales fallaba con UNIQUE en id, pero el
      // batch incluía `INSERT OR IGNORE INTO sale_items` y `UPDATE inventory`
      // (este último NO tiene OR IGNORE) — si el INSERT principal se hubiera
      // ejecutado por separado, el inventario habría sido descontado dos veces.
      // Ahora deduplicamos también por `id` antes de armar cualquier statement.
      const idempotencyKey = typeof d.idempotency_key === "string" && d.idempotency_key.trim() !== ""
        ? d.idempotency_key.trim()
        : null;
      if (idempotencyKey) {
        const existing = await db
          .prepare("SELECT id FROM sales WHERE idempotency_key = ? LIMIT 1")
          .bind(idempotencyKey)
          .first<{ id: string }>();
        if (existing) {
          // Ya procesada — replay silencioso, no descontar inventario otra vez.
          break;
        }
      }
      // Defensa adicional: replay por mismo id de cliente sin idempotency_key.
      const existingById = await db
        .prepare("SELECT id FROM sales WHERE id = ? LIMIT 1")
        .bind(id)
        .first<{ id: string }>();
      if (existingById) {
        break;
      }

      // BUG FIX C4 — validar valores numéricos finitos antes de tocar el batch.
      const subtotal = assertFinitePositive(d.subtotal ?? 0, "subtotal");
      const discountTotal = assertFinitePositive(d.discount_total ?? 0, "discount_total");
      const taxTotal = assertFinitePositive(d.tax_total ?? 0, "tax_total");
      const total = assertFinitePositive(d.total ?? subtotal + taxTotal, "total");

      const items = Array.isArray(d.items) ? d.items as Record<string, unknown>[] : [];
      const payments = Array.isArray(d.payments) ? d.payments as Record<string, unknown>[] : [];

      // Validar items antes de armar statements — un NaN en quantity rompe stock.
      for (const item of items) {
        assertFinitePositive(item.quantity ?? 0, "item.quantity");
        assertFinitePositive(item.unit_price ?? 0, "item.unit_price");
        if (item.discount !== undefined && item.discount !== null) {
          assertFinitePositive(item.discount, "item.discount");
        }
        if (item.tax_rate !== undefined && item.tax_rate !== null) {
          assertFinitePositive(item.tax_rate, "item.tax_rate");
        }
        if (item.tax_amount !== undefined && item.tax_amount !== null) {
          assertFinitePositive(item.tax_amount, "item.tax_amount");
        }
      }
      for (const pay of payments) {
        assertFinitePositive(pay.amount ?? 0, "payment.amount");
      }

      const itemStmts = items.flatMap(item => {
        const itemId = genId();
        const movId = genId();
        const qty = Number(item.quantity ?? 0);
        const price = Number(item.unit_price ?? 0);
        // BUG FIX C3 — discount estaba hardcodeado a 0; ahora respetamos el
        // payload del cliente (con fallback a 0 si no viene).
        const discount = item.discount !== undefined && item.discount !== null
          ? Number(item.discount)
          : 0;
        const lineTotal = qty * price - discount;
        return [
          db.prepare(
            `INSERT OR IGNORE INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, tax_rate, tax_amount, total, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(itemId, id, String(item.product_id ?? ""), qty, price, discount, Number(item.tax_rate ?? 0), Number(item.tax_amount ?? 0), lineTotal, now),
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
        const payId = genId();
        return db.prepare(
          `INSERT OR IGNORE INTO sale_payments (id, sale_id, payment_method, amount, created_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(payId, id, String(pay.payment_method ?? "cash"), Number(pay.amount ?? 0), now);
      });

      // Retry loop para colisiones del índice UNIQUE (branch_id, sale_number) —
      // bajo concurrencia dos pushes pueden leer el mismo MAX+1. Reintentamos
      // hasta 5 veces igual que en sales.ts POST /.
      const MAX_SALE_NUMBER_RETRIES = 5;
      let attempts = 0;
      let inserted = false;

      while (attempts < MAX_SALE_NUMBER_RETRIES && !inserted) {
        const saleNumberRow = await db
          .prepare("SELECT COALESCE(MAX(sale_number), 0) + 1 AS next_number FROM sales WHERE branch_id = ?")
          .bind(branchId)
          .first<{ next_number: number }>();
        const saleNumber = saleNumberRow?.next_number ?? 1;

        const saleInsert = db.prepare(
          `INSERT INTO sales (id, idempotency_key, branch_id, user_id, customer_id, sale_number, subtotal, discount_total, tax_total, total, status, sync_status, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'synced', ?, ?)`
        ).bind(id, idempotencyKey, branchId, userId, d.customer_id ?? null, saleNumber, subtotal, discountTotal, taxTotal, total, d.notes ?? null, now);

        try {
          await db.batch([saleInsert, ...itemStmts, ...paymentStmts]);
          inserted = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          // 1) Race con idempotency_key: la otra request ya ganó, replay silencioso.
          if (idempotencyKey && /UNIQUE|idempotency_key|idempotency/i.test(message)) {
            const existing = await db
              .prepare("SELECT id FROM sales WHERE idempotency_key = ? LIMIT 1")
              .bind(idempotencyKey)
              .first<{ id: string }>();
            if (existing) {
              inserted = true;
              break;
            }
          }

          // 2) Colisión en UNIQUE (branch_id, sale_number) → reintentar.
          const isSaleNumberConflict = /UNIQUE/i.test(message) &&
            (/sale_number/i.test(message) || /uq_sales_branch_sale_number/i.test(message));
          if (isSaleNumberConflict) {
            attempts++;
            continue;
          }

          throw err;
        }
      }

      if (!inserted) {
        throw new Error("SALE_NUMBER_CONFLICT: no se pudo generar número de venta único tras varios reintentos");
      }
      break;
    }

    case "void_sale": {
      // BUG FIX C2 — antes solo cambiaba el status; ahora:
      //   1) chequea RBAC (C5),
      //   2) valida que la venta esté en 'completed' antes de anular,
      //   3) restituye inventario y genera stock_movements 'return_in'
      //      (mismo patrón que POST /sales/:id/void en sales.ts).
      if (!VOID_ALLOWED_ROLES.has(userRole)) {
        throw new Error("FORBIDDEN: rol sin permisos para anular ventas");
      }

      const sale = await db
        .prepare("SELECT id, status, branch_id FROM sales WHERE id = ? LIMIT 1")
        .bind(id)
        .first<{ id: string; status: string; branch_id: string }>();
      if (!sale) {
        // Venta inexistente — replay raro; no-op silencioso para no romper sync.
        break;
      }
      if (sale.status === "voided") {
        // Replay del void: ya estaba anulada, no restituir inventario otra vez.
        break;
      }
      if (sale.status !== "completed") {
        throw new Error(`CONFLICT: no se puede anular venta en estado '${sale.status}'`);
      }

      const saleBranchId = sale.branch_id ?? branchId;
      const saleItems = await db
        .prepare("SELECT product_id, quantity FROM sale_items WHERE sale_id = ?")
        .bind(id)
        .all<{ product_id: string; quantity: number }>();

      const voidStmts = [
        db.prepare(
          `UPDATE sales SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, sync_status = 'synced'
           WHERE id = ? AND status = 'completed'`
        ).bind(now, userId, String(d.void_reason ?? ""), id),
        ...(saleItems.results ?? []).flatMap(item => {
          const movementId = genId();
          return [
            db.prepare(
              `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
               VALUES (?, ?, ?, 'return_in', ?, 'Anulación de venta (sync)', ?, ?)`
            ).bind(movementId, item.product_id, saleBranchId, item.quantity, userId, now),
            db.prepare(
              `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
               WHERE product_id = ? AND branch_id = ?`
            ).bind(item.quantity, now, item.product_id, saleBranchId),
          ];
        }),
      ];

      await db.batch(voidStmts);
      break;
    }

    case "expense": {
      if (op.operation !== "create") break;
      // BUG FIX C4 — validar amount antes de persistir.
      const amount = assertFinitePositive(d.amount ?? 0, "expense.amount");
      await db.prepare(
        `INSERT OR IGNORE INTO expenses (id, branch_id, user_id, concept, category, amount, payment_method, invoice_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, branchId, userId, String(d.concept ?? ""), String(d.category ?? "otros"), amount, String(d.payment_method ?? "cash"), d.invoice_url ?? null, now).run();
      break;
    }

    case "customer": {
      if (op.operation === "delete") break;
      // BUG FIX C4 — validar credit_limit; un Infinity en el límite habilita
      // crédito ilimitado a un cliente arbitrario.
      const creditLimit = assertFinitePositive(d.credit_limit ?? 0, "customer.credit_limit");
      await db.prepare(
        `INSERT OR IGNORE INTO customers (id, name, email, phone, type, credit_limit, current_debt, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      ).bind(id, String(d.name ?? ""), d.email ?? null, d.phone ?? null, String(d.type ?? "consumer"), creditLimit, now, now).run();
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

