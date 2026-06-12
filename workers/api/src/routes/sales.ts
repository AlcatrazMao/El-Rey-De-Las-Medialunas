import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const salesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// GET /
salesRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const sortOrder = c.req.query("sort_order") === "asc" ? "ASC" : "DESC";

  let query = "SELECT * FROM sales WHERE branch_id = ?";
  let countQuery = "SELECT COUNT(*) as total FROM sales WHERE branch_id = ?";
  const bindings: (string | number)[] = [branchId];
  const countBindings: (string | number)[] = [branchId];

  if (fromDate) {
    query += " AND created_at >= ?";
    countQuery += " AND created_at >= ?";
    bindings.push(fromDate);
    countBindings.push(fromDate);
  }

  if (toDate) {
    query += " AND created_at <= ?";
    countQuery += " AND created_at <= ?";
    bindings.push(toDate);
    countBindings.push(toDate);
  }

  query += ` ORDER BY created_at ${sortOrder} LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const [results, countResult] = await Promise.all([
    db.prepare(query).bind(...bindings).all(),
    db.prepare(countQuery).bind(...countBindings).first<{ total: number }>(),
  ]);

  return c.json({
    success: true,
    data: results.results ?? [],
    pagination: {
      total: countResult?.total ?? 0,
      limit,
      offset,
    },
  });
});

// GET /:id
salesRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const sale = await db
    .prepare("SELECT * FROM sales WHERE id = ? LIMIT 1")
    .bind(id)
    .first();

  if (!sale) {
    return c.json({ success: false, error: "Sale not found" }, 404);
  }

  const [itemsResult, paymentsResult] = await Promise.all([
    db
      .prepare("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC")
      .bind(id)
      .all(),
    db
      .prepare("SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at ASC")
      .bind(id)
      .all(),
  ]);

  return c.json({
    success: true,
    data: {
      ...sale,
      items: itemsResult.results ?? [],
      payments: paymentsResult.results ?? [],
    },
  });
});

// POST /
salesRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    client_id?: string;
    branch_id?: string;
    customer_id?: string;
    items: {
      product_id: string;
      quantity: number;
      unit_price: number;
      discount?: number;
      notes?: string;
    }[];
    payments: {
      payment_method: string;
      amount: number;
      reference?: string;
    }[];
    notes?: string;
    subtotal?: number;
    tax_total?: number;
    discount_total?: number;
    total?: number;
  }>();

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);
  const userId = user.id;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  const saleNumberRow = await db
    .prepare(
      "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next_number FROM sales WHERE branch_id = ?"
    )
    .bind(branchId)
    .first<{ next_number: number }>();

  const saleNumber = saleNumberRow?.next_number ?? 1;

  const items = body.items ?? [];
  const payments = body.payments ?? [];

  let subtotal = body.subtotal;
  const taxTotal = body.tax_total ?? 0;
  const discountTotal = body.discount_total ?? 0;

  if (subtotal === undefined) {
    subtotal = items.reduce((acc, item) => acc + item.unit_price * item.quantity, 0);
  }

  const total = body.total ?? subtotal - discountTotal + taxTotal;

  const saleId = crypto.randomUUID().replace(/-/g, "").toLowerCase();

  await db
    .prepare(
      `INSERT INTO sales (id, client_id, branch_id, user_id, customer_id, sale_number, subtotal, discount_total, tax_total, total, status, sync_status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'pending', ?, ?)`
    )
    .bind(
      saleId,
      body.client_id ?? null,
      branchId,
      userId,
      body.customer_id ?? null,
      saleNumber,
      subtotal,
      discountTotal,
      taxTotal,
      total,
      body.notes ?? null,
      now
    )
    .run();

  for (const item of items) {
    const itemId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    const discount = item.discount ?? 0;
    const itemTotal = item.unit_price * item.quantity - discount;

    await db
      .prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, tax_rate, tax_amount, total, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
      )
      .bind(
        itemId,
        saleId,
        item.product_id,
        item.quantity,
        item.unit_price,
        discount,
        itemTotal,
        item.notes ?? null,
        now
      )
      .run();
  }

  for (const payment of payments) {
    const paymentId = crypto.randomUUID().replace(/-/g, "").toLowerCase();

    await db
      .prepare(
        `INSERT INTO sale_payments (id, sale_id, payment_method, amount, reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        paymentId,
        saleId,
        payment.payment_method,
        payment.amount,
        payment.reference ?? null,
        now
      )
      .run();
  }

  return c.json({ success: true, data: { id: saleId } }, 201);
});

// POST /:id/void
salesRoutes.post("/:id/void", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ void_reason?: string }>().catch(() => ({}));

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);
  const userId = user.id;

  const sale = await db
    .prepare("SELECT id, status FROM sales WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!sale) {
    return c.json({ success: false, error: "Sale not found" }, 404);
  }

  if (sale.status !== "completed") {
    return c.json(
      { success: false, error: `Sale cannot be voided: current status is '${sale.status}'` },
      409
    );
  }

  const voidedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `UPDATE sales SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, sync_status = 'pending'
       WHERE id = ?`
    )
    .bind(voidedAt, userId, (body as { void_reason?: string }).void_reason ?? null, id)
    .run();

  return c.json({ success: true, data: { id, voided_at: voidedAt } });
});

// POST /:id/refund — stub preserved
salesRoutes.post("/:id/refund", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Refund sale endpoint",
  });
});

// GET /:id/receipt — stub preserved
salesRoutes.get("/:id/receipt", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Receipt download endpoint",
  });
});
