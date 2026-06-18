import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const purchaseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// GET /orders
purchaseRoutes.get("/orders", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const supplierId = c.req.query("supplier_id");
  const status = c.req.query("status");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

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
       WHERE po.id = ? LIMIT 1`
    )
    .bind(id)
    .first();

  if (!order) return c.json({ success: false, error: "Purchase order not found" }, 404);

  const items = await db
    .prepare(
      `SELECT poi.*, p.name as product_name, p.unit
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       WHERE poi.purchase_order_id = ? ORDER BY poi.created_at ASC`
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

  if (!body.supplier_id) return c.json({ success: false, error: "supplier_id is required" }, 400);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ success: false, error: "items is required and must not be empty" }, 400);
  }

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const supplier = await db
    .prepare("SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(body.supplier_id)
    .first<{ id: string }>();
  if (!supplier) return c.json({ success: false, error: "Supplier not found" }, 404);

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  const orderNumberRow = await db
    .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(order_number, 4) AS INTEGER)), 0) + 1 AS next FROM purchase_orders WHERE branch_id = ?")
    .bind(branchId)
    .first<{ next: number }>();
  const orderNumber = `OC-${String(orderNumberRow?.next ?? 1).padStart(6, "0")}`;

  const subtotal = body.items.reduce((acc, i) => acc + i.quantity * i.unit_cost, 0);
  const total = parseFloat(subtotal.toFixed(2));

  const statements = [
    db.prepare(
      `INSERT INTO purchase_orders (id, supplier_id, branch_id, user_id, order_number, subtotal, tax_total, total, expected_delivery_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(id, body.supplier_id, branchId, user.id, orderNumber, total, total, body.expected_delivery_date ?? null, body.notes ?? null, now, now),
    ...body.items.map(item => {
      const itemId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
      const itemTotal = parseFloat((item.quantity * item.unit_cost).toFixed(2));
      return db.prepare(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_cost, received_quantity, total, notes, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).bind(itemId, id, item.product_id, item.quantity, item.unit_cost, itemTotal, item.notes ?? null, now);
    }),
  ];

  await db.batch(statements);
  return c.json({ success: true, data: { id, order_number: orderNumber } }, 201);
});

// PUT /orders/:id — update status or notes
purchaseRoutes.put("/orders/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string; notes?: string; expected_delivery_date?: string }>();

  const VALID_STATUSES = new Set(["draft", "sent", "partially_received", "received", "cancelled"]);
  if (body.status && !VALID_STATUSES.has(body.status)) {
    return c.json({ success: false, error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
  }

  const existing = await db
    .prepare("SELECT id FROM purchase_orders WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Purchase order not found" }, 404);

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const fields: string[] = [];
  const vals: (string | null)[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (body.status !== undefined) { fields.push("status = ?"); vals.push(body.status); }
  if (body.notes !== undefined) { fields.push("notes = ?"); vals.push(body.notes ?? null); }
  if (body.expected_delivery_date !== undefined) { fields.push("expected_delivery_date = ?"); vals.push(body.expected_delivery_date ?? null); }

  if (fields.length === 0) return c.json({ success: false, error: "No fields to update" }, 400);

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

  if (!order) return c.json({ success: false, error: "Purchase order not found" }, 404);
  if (order.status === "cancelled") {
    return c.json({ success: false, error: "Cannot receive a cancelled purchase order" }, 409);
  }
  if (order.status === "received") {
    return c.json({ success: false, error: "Purchase order already fully received" }, 409);
  }

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const items = body.items ?? [];

  const receiveStatements = items.flatMap(item => {
    if (!item.product_id || !item.received_quantity || item.received_quantity <= 0) return [];
    const movementId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    return [
      db.prepare(
        `UPDATE purchase_order_items SET received_quantity = received_quantity + ? WHERE purchase_order_id = ? AND product_id = ?`
      ).bind(item.received_quantity, id, item.product_id),
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, unit_cost_at_time, reason, user_id, created_at)
         VALUES (?, ?, ?, 'purchase_in', ?, ?, 'Recepción OC ' || ?, ?, ?)`
      ).bind(movementId, item.product_id, order.branch_id, item.received_quantity, item.unit_cost ?? null, id, user.id, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
         WHERE product_id = ? AND branch_id = ?`
      ).bind(item.received_quantity, now, item.product_id, order.branch_id),
    ];
  });

  // Determine final status: received vs partially_received
  const allItems = await db
    .prepare("SELECT quantity, received_quantity FROM purchase_order_items WHERE purchase_order_id = ?")
    .bind(id)
    .all<{ quantity: number; received_quantity: number }>();

  const simulatedItems = (allItems.results ?? []).map(row => {
    const incoming = items.find(i => i.product_id);
    return incoming
      ? { quantity: row.quantity, received: row.received_quantity + incoming.received_quantity }
      : { quantity: row.quantity, received: row.received_quantity };
  });

  const allReceived = simulatedItems.every(i => i.received >= i.quantity);
  const newStatus = allReceived ? "received" : "partially_received";

  receiveStatements.push(
    db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?")
      .bind(newStatus, now, id)
  );

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

  if (!order) return c.json({ success: false, error: "Purchase order not found" }, 404);
  if (order.status === "received") {
    return c.json({ success: false, error: "Cannot cancel a received purchase order" }, 409);
  }
  if (order.status === "cancelled") {
    return c.json({ success: false, error: "Purchase order is already cancelled" }, 409);
  }

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return c.json({ success: true, data: { id, status: "cancelled", updated_at: now } });
});
