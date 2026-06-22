import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const purchaseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
// SECURITY: cap monetary and quantity inputs to avoid Infinity-adjacent or
// absurd values poisoning totals.
const MAX_QUANTITY = 1_000_000;
const MAX_UNIT_COST = 10_000_000;
const MAX_ITEMS_PER_ORDER = 500;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// GET /orders
purchaseRoutes.get("/orders", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const supplierId = c.req.query("supplier_id");
  const status = c.req.query("status");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

  let query = `
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.branch_id = ?`;
  const bindings: (string | number)[] = [branchId];

  if (supplierId) { query += " AND po.supplier_id = ?"; bindings.push(supplierId); }
  if (status) { query += " AND po.status = ?"; bindings.push(status); }
  if (fromDate) { query += " AND po.created_at >= ?"; bindings.push(fromDate); }
  if (toDate) { query += " AND po.created_at <= ?"; bindings.push(toDate); }

  query += " ORDER BY po.created_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db.prepare(query).bind(...bindings).all();
  return c.json({ success: true, data: results.results ?? [] });
});

// GET /orders/:id
purchaseRoutes.get("/orders/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const order = await db
    .prepare(
      `SELECT po.*, s.name as supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = ? LIMIT 1`,
    )
    .bind(id)
    .first();

  if (!order) return c.json(errBody("NOT_FOUND", "Orden de compra no encontrada"), 404);

  const items = await db
    .prepare(
      `SELECT poi.*, p.name as product_name, p.unit
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       WHERE poi.purchase_order_id = ? ORDER BY poi.created_at ASC`,
    )
    .bind(id)
    .all();

  return c.json({ success: true, data: { ...order, items: items.results ?? [] } });
});

// POST /orders
purchaseRoutes.post("/orders", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    supplier_id: string;
    branch_id?: string;
    items: { product_id: string; quantity: number; unit_cost: number; notes?: string }[];
    expected_delivery_date?: string;
    notes?: string;
  }>();

  if (!body.supplier_id) return c.json(errBody("VALIDATION_ERROR", "supplier_id es requerido"), 400);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json(errBody("VALIDATION_ERROR", "items es requerido y no puede estar vacío"), 400);
  }
  if (body.items.length > MAX_ITEMS_PER_ORDER) {
    return c.json(errBody("VALIDATION_ERROR", `Una orden no puede tener más de ${MAX_ITEMS_PER_ORDER} items`), 400);
  }

  // SECURITY: validate every item BEFORE we hit the DB so we cannot insert
  // garbage rows (NaN/Infinity/negative quantities) into purchase_order_items.
  for (const item of body.items) {
    if (!item.product_id || typeof item.product_id !== 'string') {
      return c.json(errBody("VALIDATION_ERROR", "item.product_id es requerido"), 400);
    }
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QUANTITY) {
      return c.json(errBody("VALIDATION_ERROR", "item.quantity debe ser un número finito > 0"), 400);
    }
    const cost = Number(item.unit_cost);
    if (!Number.isFinite(cost) || cost < 0 || cost > MAX_UNIT_COST) {
      return c.json(errBody("VALIDATION_ERROR", "item.unit_cost debe ser un número finito >= 0"), 400);
    }
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear órdenes de compra"), 403);
  }

  const supplier = await db
    .prepare("SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(body.supplier_id)
    .first<{ id: string }>();
  if (!supplier) return c.json(errBody("NOT_FOUND", "Proveedor no encontrado"), 404);

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const id = genId();
  const now = nowSqliteTs();

  const subtotal = body.items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.unit_cost), 0);
  const total = parseFloat(subtotal.toFixed(2));

  const itemStatements = body.items.map(item => {
    const itemId = genId();
    const itemTotal = parseFloat((Number(item.quantity) * Number(item.unit_cost)).toFixed(2));
    return db.prepare(
      `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_cost, received_quantity, total, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(itemId, id, item.product_id, item.quantity, item.unit_cost, itemTotal, item.notes ?? null, now);
  });

  // BUG FIX C7 — bajo concurrencia, dos OCs leyendo el mismo MAX+1 colisionarían
  // en el UNIQUE de order_number (o duplicarían sin UNIQUE). Mismo patrón
  // retry-loop que sale_number en sales.ts.
  const MAX_ORDER_NUMBER_RETRIES = 5;
  let attempts = 0;
  let inserted = false;
  let orderNumber = "";

  while (attempts < MAX_ORDER_NUMBER_RETRIES && !inserted) {
    const orderNumberRow = await db
      .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(order_number, 4) AS INTEGER)), 0) + 1 AS next FROM purchase_orders WHERE branch_id = ?")
      .bind(branchId)
      .first<{ next: number }>();
    orderNumber = `OC-${String(orderNumberRow?.next ?? 1).padStart(6, "0")}`;

    const orderInsert = db.prepare(
      `INSERT INTO purchase_orders (id, supplier_id, branch_id, user_id, order_number, subtotal, tax_total, total, expected_delivery_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    ).bind(id, body.supplier_id, branchId, user.id, orderNumber, total, total, body.expected_delivery_date ?? null, body.notes ?? null, now, now);

    try {
      await db.batch([orderInsert, ...itemStatements]);
      inserted = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isOrderNumberConflict = /UNIQUE/i.test(message) && /order_number/i.test(message);
      if (isOrderNumberConflict) {
        attempts++;
        continue;
      }
      throw err;
    }
  }

  if (!inserted) {
    return c.json(errBody("ORDER_NUMBER_CONFLICT", "No se pudo generar número de orden único tras varios reintentos"), 500);
  }
  return c.json({ success: true, data: { id, order_number: orderNumber } }, 201);
});

// PUT /orders/:id — update status or notes
purchaseRoutes.put("/orders/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string; notes?: string; expected_delivery_date?: string }>();

  const VALID_STATUSES = new Set(["draft", "sent", "partially_received", "received", "cancelled"]);
  if (body.status && !VALID_STATUSES.has(body.status)) {
    return c.json(errBody("VALIDATION_ERROR", `status inválido. Debe ser uno de: ${[...VALID_STATUSES].join(", ")}`), 400);
  }

  const existing = await db
    .prepare("SELECT id FROM purchase_orders WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Orden de compra no encontrada"), 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar órdenes de compra"), 403);
  }

  const fields: string[] = [];
  const vals: (string | null)[] = [];
  const now = nowSqliteTs();

  if (body.status !== undefined) { fields.push("status = ?"); vals.push(body.status); }
  if (body.notes !== undefined) { fields.push("notes = ?"); vals.push(body.notes ?? null); }
  if (body.expected_delivery_date !== undefined) { fields.push("expected_delivery_date = ?"); vals.push(body.expected_delivery_date ?? null); }

  if (fields.length === 0) return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);

  fields.push("updated_at = ?");
  vals.push(now, id);

  await db.prepare(`UPDATE purchase_orders SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true, data: { id, updated_at: now } });
});

// POST /orders/:id/receive — mark items as received, update inventory
purchaseRoutes.post("/orders/:id/receive", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    items: { product_id: string; received_quantity: number; unit_cost?: number }[];
    notes?: string;
  }>().catch((): { items: { product_id: string; received_quantity: number; unit_cost?: number }[]; notes?: string } => ({ items: [], notes: undefined }));

  const order = await db
    .prepare("SELECT id, branch_id, status FROM purchase_orders WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; branch_id: string; status: string }>();

  if (!order) return c.json(errBody("NOT_FOUND", "Orden de compra no encontrada"), 404);
  if (order.status === "cancelled") {
    return c.json(errBody("CONFLICT", "No se puede recibir una orden cancelada"), 409);
  }
  if (order.status === "received") {
    return c.json(errBody("CONFLICT", "La orden ya fue recibida completamente"), 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor" && userRole !== "warehouse") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para recibir órdenes de compra"), 403);
  }

  const now = nowSqliteTs();
  const items = body.items ?? [];

  // SECURITY: validate every receive item before mutating inventory. A
  // negative or Infinity received_quantity would corrupt stock totals.
  for (const item of items) {
    if (!item.product_id || typeof item.product_id !== 'string') {
      return c.json(errBody("VALIDATION_ERROR", "item.product_id es requerido"), 400);
    }
    const qty = Number(item.received_quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QUANTITY) {
      return c.json(errBody("VALIDATION_ERROR", "item.received_quantity debe ser un número finito > 0"), 400);
    }
    if (item.unit_cost !== undefined && item.unit_cost !== null) {
      const cost = Number(item.unit_cost);
      if (!Number.isFinite(cost) || cost < 0 || cost > MAX_UNIT_COST) {
        return c.json(errBody("VALIDATION_ERROR", "item.unit_cost debe ser un número finito >= 0"), 400);
      }
    }
  }

  // BUG FIX C6 — necesitamos el estado actual de la orden ANTES de aplicar:
  //   1) para validar overshoot (recibido + entrante > pedido),
  //   2) para detectar idempotency (ya 100% recibida → no re-ejecutar),
  //   3) para usar unit_cost de purchase_order_items como fallback si el
  //      cliente no manda unit_cost (BUG FIX C6 fallback de cost).
  const allItems = await db
    .prepare("SELECT product_id, quantity, received_quantity, unit_cost FROM purchase_order_items WHERE purchase_order_id = ?")
    .bind(id)
    .all<{ product_id: string; quantity: number; received_quantity: number; unit_cost: number }>();

  const orderItemsByProduct = new Map<string, { quantity: number; received_quantity: number; unit_cost: number }>();
  for (const row of allItems.results ?? []) {
    orderItemsByProduct.set(row.product_id, {
      quantity: Number(row.quantity),
      received_quantity: Number(row.received_quantity),
      unit_cost: Number(row.unit_cost),
    });
  }

  // BUG FIX C6 (idempotency): si la OC ya está 100% recibida antes de sumar,
  // un segundo POST (doble-click) generaría stock_movements duplicados e
  // inflaría inventario. Devolvemos 200 con el estado actual sin re-ejecutar.
  const alreadyFullyReceived = (allItems.results ?? []).length > 0 &&
    (allItems.results ?? []).every(row => Number(row.received_quantity) >= Number(row.quantity));
  if (alreadyFullyReceived) {
    return c.json({ success: true, data: { id, status: "received", already_received: true } });
  }

  // Consolidar items por product_id antes de validar — si el cliente manda el
  // mismo product_id dos veces, el guard por-item los pasaría individualmente
  // pero el batch los aplicaría en acumulado, produciendo overshoot real.
  const consolidatedItems = new Map<string, { received_quantity: number; unit_cost?: number | null }>();
  for (const item of items) {
    const prev = consolidatedItems.get(item.product_id);
    consolidatedItems.set(item.product_id, {
      received_quantity: (prev?.received_quantity ?? 0) + Number(item.received_quantity),
      unit_cost: item.unit_cost ?? prev?.unit_cost,
    });
  }

  // BUG FIX C6 (overshoot guard): rechazar si recibido + entrante > pedido.
  for (const [productId, incoming] of consolidatedItems) {
    const orderRow = orderItemsByProduct.get(productId);
    if (!orderRow) {
      return c.json(errBody("VALIDATION_ERROR", `El producto ${productId} no pertenece a esta orden`), 400);
    }
    if (orderRow.received_quantity + incoming.received_quantity > orderRow.quantity) {
      return c.json(
        errBody("OVERSHOOT", `Cantidad recibida (${orderRow.received_quantity + incoming.received_quantity}) excede la pedida (${orderRow.quantity}) para el producto ${productId}`),
        409,
      );
    }
  }

  const receiveStatements = [...consolidatedItems.entries()].flatMap(([productId, incoming]) => {
    if (!productId || incoming.received_quantity <= 0) return [];
    const movementId = genId();
    const orderRow = orderItemsByProduct.get(productId);
    const unitCostAtTime = incoming.unit_cost !== undefined && incoming.unit_cost !== null
      ? Number(incoming.unit_cost)
      : (orderRow ? orderRow.unit_cost : null);
    return [
      db.prepare(
        `UPDATE purchase_order_items SET received_quantity = received_quantity + ? WHERE purchase_order_id = ? AND product_id = ?`,
      ).bind(incoming.received_quantity, id, productId),
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, unit_cost_at_time, reason, user_id, created_at)
         VALUES (?, ?, ?, 'purchase_in', ?, ?, 'Recepción OC ' || ?, ?, ?)`,
      ).bind(movementId, productId, order.branch_id, incoming.received_quantity, unitCostAtTime, id, user.id, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
         WHERE product_id = ? AND branch_id = ?`,
      ).bind(incoming.received_quantity, now, productId, order.branch_id),
    ];
  });

  const simulatedItems = (allItems.results ?? []).map(row => {
    const inc = consolidatedItems.get(row.product_id);
    return inc
      ? { quantity: row.quantity, received: row.received_quantity + inc.received_quantity }
      : { quantity: row.quantity, received: row.received_quantity };
  });

  const allReceived = simulatedItems.every(i => i.received >= i.quantity);
  const newStatus = allReceived ? "received" : "partially_received";

  receiveStatements.push(
    db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?")
      .bind(newStatus, now, id),
  );

  // SECURITY: D1 batch limit is ~100 statements. Receiving an order with many
  // items would otherwise silently fail or throw a generic error.
  if (receiveStatements.length > 100) {
    return c.json(errBody("VALIDATION_ERROR", "Demasiados items para recibir en una sola operación. Dividilo en varias."), 400);
  }

  if (receiveStatements.length > 0) await db.batch(receiveStatements);

  return c.json({ success: true, data: { id, status: newStatus, received_at: now } });
});

// POST /orders/:id/cancel
purchaseRoutes.post("/orders/:id/cancel", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const order = await db
    .prepare("SELECT id, status FROM purchase_orders WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!order) return c.json(errBody("NOT_FOUND", "Orden de compra no encontrada"), 404);
  if (order.status === "received") {
    return c.json(errBody("CONFLICT", "No se puede cancelar una orden ya recibida"), 409);
  }
  if (order.status === "cancelled") {
    return c.json(errBody("CONFLICT", "La orden ya está cancelada"), 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para cancelar órdenes de compra"), 403);
  }

  const now = nowSqliteTs();
  await db
    .prepare("UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return c.json({ success: true, data: { id, status: "cancelled", updated_at: now } });
});
