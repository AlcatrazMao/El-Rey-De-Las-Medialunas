import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// SECURITY: cap de operaciones por push. Cada operación "sale" puede lanzar
// N+1 queries a D1 (SELECT MAX + batch items+payments). Bajado de 200 a 50
// para evitar timeouts (~30s en Workers) por 200 × ~10 statements = 2000
// round-trips. Clientes deben fragmentar pushes grandes.
export const MAX_OPERATIONS_PER_PUSH = 50;

// FIX R8-5 — caps monetarios y de cantidad para operaciones sync.
// Sin estos caps, un cliente offline con datos corruptos (Infinity, valores
// astronómicos) puede inyectar valores que inflan totales financieros y stock.
// Se usan los mismos valores que los endpoints directos (expenses.ts, sales.ts).
const MAX_EXPENSE_AMOUNT = 10_000_000;
const MAX_ITEM_QUANTITY = 100_000;
const MAX_UNIT_PRICE = 10_000_000;

// SECURITY: numeric inputs vienen de la cola offline del cliente y pueden ser
// NaN/Infinity por bugs en serialización (ej. Number(undefined)). Si dejamos
// que lleguen al INSERT, contaminamos totales financieros y stock con valores
// inválidos. assertFinitePositive lanza para abortar la operación.
//
// Nota: el cliente puede serializar NaN como el string "NaN" o enviar null.
// Number("NaN") === NaN pasa el typeof check pero sí falla Number.isFinite;
// sin embargo el guard explícito de typeof evita coerciones silenciosas para
// string/null/undefined que podrían enmascarar bugs en el cliente.
export function assertFinitePositive(v: unknown, field: string): number {
  if (typeof v !== "number") {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)} (expected number, got ${typeof v})`);
  }
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`INVALID_NUMERIC: ${field}=${String(v)}`);
  }
  return v;
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
  // Fix 4: LIMIT 500 en cada query — un cliente 30 días offline puede tener
  // miles de filas y superar el límite de 32 MB de D1. No implementamos cursor
  // todavía; esto es un cap de seguridad para evitar timeouts y OOM.
  const PULLABLE: { type: string; query: string; bindings: unknown[] }[] = [
    {
      type: "products",
      query: `SELECT * FROM products WHERE branch_id = ? AND updated_at > ? LIMIT 500`,
      bindings: [branchId, since],
    },
    {
      type: "categories",
      query: `SELECT * FROM categories WHERE branch_id = ? AND updated_at > ? LIMIT 500`,
      bindings: [branchId, since],
    },
    {
      type: "inventory",
      query: `SELECT i.*, p.name as product_name FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.branch_id = ? AND i.updated_at > ? LIMIT 500`,
      bindings: [branchId, since],
    },
    {
      type: "customers",
      query: `SELECT * FROM customers WHERE updated_at > ? LIMIT 500`,
      bindings: [since],
    },
    {
      type: "sales",
      query: `SELECT * FROM sales WHERE branch_id = ? AND created_at > ? LIMIT 500`,
      bindings: [branchId, since],
    },
    {
      type: "batches",
      query: `SELECT ib.*, p.name as product_name FROM inventory_batches ib LEFT JOIN products p ON p.id = ib.product_id WHERE ib.branch_id = ? AND ib.created_at > ? LIMIT 500`,
      bindings: [branchId, since],
    },
    {
      type: "offers",
      query: `SELECT * FROM offers WHERE branch_id = ? AND updated_at > ? LIMIT 500`,
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

  // SECURITY: cross-branch privilege escalation guard.
  // El cliente puede mandar `branch_id` arbitrario en el body. Sin este check,
  // un cajero de sucursal A podría inyectar operaciones (ventas, gastos, batches)
  // marcadas con `branch_id` de sucursal B y contaminar sus métricas y stock.
  // admin/owner pueden operar en cualquier sucursal; el resto solo en las suyas
  // (membresía via tabla user_branches, ya que users no tiene branch_id directo).
  if (userRole !== "admin" && userRole !== "owner") {
    const membership = await db
      .prepare("SELECT 1 AS ok FROM user_branches WHERE user_id = ? AND branch_id = ? LIMIT 1")
      .bind(user.id, branchId)
      .first<{ ok: number }>();
    if (!membership) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No podés operar en otra sucursal" } },
        403,
      );
    }
  }

  if (operations.length > MAX_OPERATIONS_PER_PUSH) {
    return c.json(
      {
        success: false,
        error: {
          code: "TOO_MANY_OPERATIONS",
          max: MAX_OPERATIONS_PER_PUSH,
        },
      },
      400,
    );
  }
  let processed = 0;
  let failed = 0;
  const errors: { client_id: string; entity_type: string; code: string; message: string }[] = [];

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
      const msg = e instanceof Error ? e.message : String(e);
      // Structured errors thrown by applyOperation carry a code prefix (e.g.
      // "FORBIDDEN: ..."). Expose the code to the client so it can react
      // (e.g. skip retrying FORBIDDEN ops); keep the raw message server-side.
      const codeMatch = /^([A-Z_]+):/.exec(msg);
      const code = codeMatch?.[1] ?? "APPLY_FAILED";
      errors.push({ client_id: op.client_id, entity_type: op.entity_type, code, message: code === "APPLY_FAILED" ? "Error al aplicar operación" : msg.replace(/^[A-Z_]+:\s*/, "") });
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
        const itemQty = assertFinitePositive(item.quantity ?? 0, "item.quantity");
        const itemPrice = assertFinitePositive(item.unit_price ?? 0, "item.unit_price");
        // FIX R8-5 — caps de cantidad y precio por item, igual que sales.ts POST /.
        if (itemQty > MAX_ITEM_QUANTITY) {
          throw new Error(`VALIDATION_ERROR: item.quantity ${itemQty} supera el máximo permitido de ${MAX_ITEM_QUANTITY}`);
        }
        if (itemPrice > MAX_UNIT_PRICE) {
          throw new Error(`VALIDATION_ERROR: item.unit_price ${itemPrice} supera el máximo permitido de ${MAX_UNIT_PRICE}`);
        }
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
        const invId = genId();
        const qty = Number(item.quantity ?? 0);
        const price = Number(item.unit_price ?? 0);
        // BUG FIX C3 — discount estaba hardcodeado a 0; ahora respetamos el
        // payload del cliente (con fallback a 0 si no viene).
        const discount = item.discount !== undefined && item.discount !== null
          ? Number(item.discount)
          : 0;
        const lineTotal = qty * price - discount;
        const productId = String(item.product_id ?? "");
        return [
          db.prepare(
            `INSERT OR IGNORE INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, tax_rate, tax_amount, total, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(itemId, id, productId, qty, price, discount, Number(item.tax_rate ?? 0), Number(item.tax_amount ?? 0), lineTotal, now),
          db.prepare(
            `INSERT OR IGNORE INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
             VALUES (?, ?, ?, 'sale_out', ?, 'Venta sync offline', ?, ?)`
          ).bind(movId, productId, branchId, qty, userId, now),
          // Fix 2: garantizar que la fila de inventory exista antes del UPDATE.
          // Si el producto nunca tuvo movimiento en esta sucursal, el UPDATE
          // afecta 0 filas y el stock queda sin decrementar — igual que en
          // inventory.ts:192-198 que también hace INSERT OR IGNORE primero.
          db.prepare(
            `INSERT OR IGNORE INTO inventory (id, product_id, branch_id, current_quantity, updated_at)
             VALUES (?, ?, ?, 0, ?)`
          ).bind(invId, productId, branchId, now),
          db.prepare(
            `UPDATE inventory SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
             WHERE product_id = ? AND branch_id = ?`
          ).bind(qty, now, productId, branchId),
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

      // Fix 1 — CRITICAL: verificar que la venta pertenece al branch del push.
      // Un operador de sucursal A podría intentar anular una venta de sucursal B
      // enviando su id en el payload. admin/owner pueden anular en cualquier branch.
      if (sale.branch_id !== branchId && userRole !== "admin" && userRole !== "owner") {
        throw new Error("FORBIDDEN: La venta pertenece a otra sucursal");
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
      // Fix 3 — MEDIUM: RBAC para gastos.
      if (!["admin", "owner", "supervisor"].includes(userRole)) {
        throw new Error("FORBIDDEN: Sin permisos para registrar gastos");
      }
      // BUG FIX C4 — validar amount antes de persistir.
      const amount = assertFinitePositive(d.amount ?? 0, "expense.amount");
      // FIX R8-5 — cap de monto para evitar gastos con valores absurdos.
      if (amount > MAX_EXPENSE_AMOUNT) {
        throw new Error(`VALIDATION_ERROR: expense.amount ${amount} supera el máximo permitido de ${MAX_EXPENSE_AMOUNT}`);
      }
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
      if (op.operation === "create") {
        // INSERT OR IGNORE: si ya existe, no sobreescribir — puede tener datos
        // actualizados desde otro dispositivo.
        await db.prepare(
          `INSERT OR IGNORE INTO customers (id, name, email, phone, type, credit_limit, current_debt, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
        ).bind(id, String(d.name ?? ""), d.email ?? null, d.phone ?? null, String(d.type ?? "consumer"), creditLimit, now, now).run();
      } else if (op.operation === "update") {
        // Fix 3: INSERT OR IGNORE descartaba actualizaciones silenciosamente.
        // Para "update" usamos UPDATE directo — si el cliente no existe aún en
        // el servidor, el UPDATE afecta 0 filas (no-op seguro); el "create"
        // previo lo creará en su operación correspondiente.
        await db.prepare(
          `UPDATE customers
           SET name = ?, email = ?, phone = ?, type = ?, credit_limit = ?, is_active = ?, updated_at = ?
           WHERE id = ?`
        ).bind(
          String(d.name ?? ""),
          d.email ?? null,
          d.phone ?? null,
          String(d.type ?? "consumer"),
          creditLimit,
          d.is_active !== undefined ? (d.is_active ? 1 : 0) : 1,
          now,
          id,
        ).run();
      }
      break;
    }

    case "cash_session": {
      if (op.operation !== "create") break;
      const cashSessionResult = await db.prepare(
        `INSERT OR IGNORE INTO cash_sessions (id, branch_id, user_id, opening_amount, notes, opened_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, branchId, userId, Number(d.opening_amount ?? 0), d.notes ?? null, String(d.opened_at ?? now)).run();
      // Fix 6 — ALTO: INSERT OR IGNORE silencioso para cash_session.
      // Si meta.changes === 0, hubo colisión de ID (sesión ya existente).
      // No es error para el cliente — la sesión existe con los mismos datos —
      // pero sí merece logging para detectar bugs en el cliente.
      if (cashSessionResult.meta.changes === 0) {
        console.warn(`[sync] cash_session INSERT ignored (duplicate id=${id})`);
      }
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
      // Fix 4 — MEDIUM: RBAC para lotes de inventario.
      if (!["admin", "owner", "supervisor", "warehouse", "production"].includes(userRole)) {
        throw new Error("FORBIDDEN: Sin permisos para gestionar lotes de inventario");
      }
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
      // Fix 2 — MEDIUM: RBAC para gestión de ofertas.
      if (!["admin", "owner", "supervisor"].includes(userRole)) {
        throw new Error("FORBIDDEN: Sin permisos para gestionar ofertas");
      }

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
        // Upsert manual: UPDATE primero; si no afecta filas (offer creada
        // offline cuyo "create" nunca llegó al servidor), hacer INSERT para no
        // perder la offer para siempre. No usamos INSERT OR REPLACE para no
        // destruir el created_at original si eventualmente llega tarde.
        const updateResult = await db.prepare(
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

        if (updateResult.meta.changes === 0) {
          // Fila no existe — insertar para no perder la offer
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
        }
      }
      break;
    }

    case "close_session": {
      // Fix 5 — MEDIUM: validar existencia, estado, branch y ownership.
      // Fix R7-1 — CRÍTICO: columna correcta es user_id, no opened_by.
      const session = await db
        .prepare("SELECT id, user_id, branch_id, status FROM cash_sessions WHERE id = ? LIMIT 1")
        .bind(id)
        .first<{ id: string; user_id: string; branch_id: string; status: string }>();

      if (!session || session.status === "closed") {
        throw new Error("ALREADY_CLOSED: La sesión de caja no existe o ya fue cerrada");
      }

      // Solo admin/owner pueden cerrar sesiones de otros branches.
      if (session.branch_id !== branchId && userRole !== "admin" && userRole !== "owner") {
        throw new Error("FORBIDDEN: La sesión pertenece a otra sucursal");
      }

      // Cajeros solo pueden cerrar su propia sesión.
      if (userRole === "cashier" && session.user_id !== userId) {
        throw new Error("FORBIDDEN: Un cajero solo puede cerrar su propia sesión de caja");
      }

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

