import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const salesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001"; // fallback — configure via branch_id query param

// GET /
salesRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
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
      tax_rate?: number;
      tax_amount?: number;
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

  // TODO: add UNIQUE constraint on (branch_id, sale_number) in a migration to prevent
  // duplicate sale numbers under concurrent requests (MAX+1 is not safe without a lock).
  const saleNumberRow = await db
    .prepare(
      "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next_number FROM sales WHERE branch_id = ?"
    )
    .bind(branchId)
    .first<{ next_number: number }>();

  const saleNumber = saleNumberRow?.next_number ?? 1;

  const items = body.items ?? [];
  if (items.length === 0) {
    return c.json({ success: false, error: "A sale must have at least one item" }, 400);
  }
  for (const item of items) {
    if (!item.product_id) return c.json({ success: false, error: 'item.product_id is required' }, 400);
    if (Number(item.quantity) <= 0) return c.json({ success: false, error: 'item.quantity must be > 0' }, 400);
    if (Number(item.unit_price) < 0) return c.json({ success: false, error: 'item.unit_price must be >= 0' }, 400);
  }
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

  const itemStatements = items.flatMap(item => {
    const itemId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    const movementId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    const discount = item.discount ?? 0;
    const itemTotal = item.unit_price * item.quantity - discount;

    return [
      db.prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, tax_rate, tax_amount, total, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        itemId, saleId, item.product_id, item.quantity,
        item.unit_price, discount,
        item.tax_rate ?? 0, item.tax_amount ?? 0,
        itemTotal, item.notes ?? null, now
      ),
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'sale_out', ?, 'Venta automática', ?, ?)`
      ).bind(movementId, item.product_id, branchId, item.quantity, userId, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
         WHERE product_id = ? AND branch_id = ?`
      ).bind(item.quantity, now, item.product_id, branchId),
    ];
  });

  const paymentStatements = payments.map(payment => {
    const paymentId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    return db.prepare(
      `INSERT INTO sale_payments (id, sale_id, payment_method, amount, reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(paymentId, saleId, payment.payment_method, payment.amount, payment.reference ?? null, now);
  });

  const allStatements = [...itemStatements, ...paymentStatements];
  if (allStatements.length > 0) await db.batch(allStatements);

  return c.json({ success: true, data: { id: saleId, sale_number: saleNumber, branch_id: branchId, created_at: now } }, 201);
});

// POST /:id/void
salesRoutes.post("/:id/void", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ void_reason?: string }>().catch((): { void_reason?: string } => ({}));

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

  const saleItems = await db
    .prepare("SELECT product_id, quantity FROM sale_items WHERE sale_id = ?")
    .bind(id)
    .all<{ product_id: string; quantity: number }>();

  const voidStatements = [
    db.prepare(
      `UPDATE sales SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, sync_status = 'pending'
       WHERE id = ?`
    ).bind(voidedAt, userId, (body as { void_reason?: string }).void_reason ?? null, id),
    ...(saleItems.results ?? []).flatMap(item => {
      const movementId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
      return [
        db.prepare(
          `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, (SELECT branch_id FROM sales WHERE id = ?), 'return_in', ?, 'Anulación de venta', ?, ?)`
        ).bind(movementId, item.product_id, id, item.quantity, userId, voidedAt),
        db.prepare(
          `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
           WHERE product_id = ? AND branch_id = (SELECT branch_id FROM sales WHERE id = ?)`
        ).bind(item.quantity, voidedAt, item.product_id, id),
      ];
    }),
  ];

  await db.batch(voidStatements);

  return c.json({ success: true, data: { id, voided_at: voidedAt } });
});

// POST /:id/refund
salesRoutes.post("/:id/refund", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ reason?: string; items?: { sale_item_id?: string; product_id?: string; quantity: number }[] }>()
    .catch(() => ({}) as { reason?: string; items?: { sale_item_id?: string; product_id?: string; quantity: number }[] });

  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);
  const userId = user.id;

  const sale = await db
    .prepare(
      `SELECT s.*, u.name AS cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ? LIMIT 1`
    )
    .bind(id)
    .first<{ id: string; status: string; branch_id: string }>();

  if (!sale) return c.json({ success: false, error: "Sale not found" }, 404);
  if (sale.status === "voided") {
    return c.json({ success: false, error: "Sale already voided" }, 400);
  }
  if (sale.status === "refunded") {
    return c.json({ success: false, error: "Sale already refunded" }, 400);
  }

  const saleItems = await db
    .prepare(
      "SELECT id, product_id, batch_id, quantity FROM sale_items WHERE sale_id = ?"
    )
    .bind(id)
    .all<{ id: string; product_id: string; batch_id: string | null; quantity: number }>();

  const allItems = saleItems.results ?? [];
  const requested = body.items ?? [];
  const partial = requested.length > 0;

  const toRefund: { product_id: string; batch_id: string | null; quantity: number }[] = [];

  if (partial) {
    // Key by sale_item id to correctly handle the same product appearing on multiple lines.
    // Also build a product_id index for backwards-compatible callers that don't send sale_item_id.
    const itemsById = new Map<
      string,
      { id: string; product_id: string; batch_id: string | null; quantity: number }
    >();
    const itemsByProduct = new Map<
      string,
      { id: string; product_id: string; batch_id: string | null; quantity: number }
    >();
    for (const it of allItems) {
      itemsById.set(it.id, it);
      // last-writer wins for product_id fallback — only safe when product appears once
      itemsByProduct.set(it.product_id, it);
    }
    for (const req of requested) {
      // Prefer explicit sale_item_id; fall back to product_id for backwards compat
      const matched = req.sale_item_id
        ? itemsById.get(req.sale_item_id)
        : (req.product_id ? itemsByProduct.get(req.product_id) : undefined);
      const label = req.sale_item_id ?? req.product_id ?? "(unknown)";
      if (!matched) {
        return c.json(
          { success: false, error: `Item ${label} is not part of this sale` },
          400
        );
      }
      if (req.quantity <= 0 || req.quantity > matched.quantity) {
        return c.json(
          {
            success: false,
            error: `Refund quantity for ${label} must be > 0 and <= ${matched.quantity}`,
          },
          400
        );
      }
      toRefund.push({
        product_id: matched.product_id,
        batch_id: matched.batch_id,
        quantity: req.quantity,
      });
    }
  } else {
    for (const it of allItems) {
      toRefund.push({ product_id: it.product_id, batch_id: it.batch_id, quantity: it.quantity });
    }
  }

  const refundedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const reason = body.reason ?? "Reembolso";
  const branchId = sale.branch_id;

  const stmts = [
    db.prepare(
      `UPDATE sales SET status = 'refunded', refunded_at = ?, refunded_by = ?, refund_reason = ?, sync_status = 'pending'
       WHERE id = ?`
    ).bind(refundedAt, userId, reason, id),
    ...toRefund.flatMap((item) => {
      const movementId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
      const baseStmts = [
        db.prepare(
          `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, ?, 'return_in', ?, 'Reembolso', ?, ?)`
        ).bind(movementId, item.product_id, branchId, item.quantity, userId, refundedAt),
        db.prepare(
          `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
           WHERE product_id = ? AND branch_id = ?`
        ).bind(item.quantity, refundedAt, item.product_id, branchId),
      ];
      if (item.batch_id) {
        baseStmts.push(
          db.prepare(
            `UPDATE inventory_batches SET remaining_quantity = remaining_quantity + ? WHERE id = ?`
          ).bind(item.quantity, item.batch_id)
        );
      }
      return baseStmts;
    }),
  ];

  await db.batch(stmts);

  return c.json({
    success: true,
    data: { id, refunded_at: refundedAt, items_refunded: toRefund.length },
  });
});

// GET /:id/receipt
salesRoutes.get("/:id/receipt", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const format = c.req.query("format") ?? "json";
  if (format !== "json" && format !== "html") {
    return c.json({ success: false, error: 'format must be "json" or "html"' }, 400);
  }

  const sale = await db
    .prepare(
      `SELECT s.*,
        u.name AS cashier_name,
        c.name AS customer_name, c.document_type, c.phone AS customer_phone
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? LIMIT 1`
    )
    .bind(id)
    .first<{
      id: string;
      sale_number: number;
      branch_id: string | null;
      subtotal: number;
      discount_total: number;
      tax_total: number;
      total: number;
      status: string;
      notes: string | null;
      created_at: string;
      cashier_name: string | null;
      customer_name: string | null;
      document_type: string | null;
      customer_phone: string | null;
    }>();

  if (!sale) return c.json({ success: false, error: "Sale not found" }, 404);

  const [itemsResult, paymentsResult, branch] = await Promise.all([
    db
      .prepare(
        `SELECT si.*, p.name AS product_name, p.code AS product_code
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = ?
         ORDER BY si.created_at`
      )
      .bind(id)
      .all<{
        product_name: string | null;
        product_code: string | null;
        quantity: number;
        unit_price: number;
        total: number;
      }>(),
    db
      .prepare(
        "SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at"
      )
      .bind(id)
      .all<{ payment_method: string; amount: number }>(),
    db
      .prepare("SELECT name, address, phone FROM branches WHERE id = ? LIMIT 1")
      .bind(sale.branch_id ?? DEFAULT_BRANCH)
      .first<{ name: string; address: string | null; phone: string | null }>(),
  ]);

  const items = itemsResult.results ?? [];
  const payments = paymentsResult.results ?? [];

  if (format === "json") {
    return c.json({
      success: true,
      data: { sale, items, payments, branch },
    });
  }

  const html = renderReceiptHtml({ sale, items, payments, branch });
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

interface ReceiptData {
  sale: {
    id: string;
    sale_number: number;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    status: string;
    created_at: string;
    cashier_name: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  };
  items: {
    product_name: string | null;
    product_code: string | null;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  payments: { payment_method: string; amount: number }[];
  branch: { name: string; address: string | null; phone: string | null } | null;
}

function escapeHtml(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function renderReceiptHtml(data: ReceiptData): string {
  const { sale, items, payments, branch } = data;
  const banner =
    sale.status === "voided"
      ? `<div class="banner">ANULADA</div>`
      : sale.status === "refunded"
        ? `<div class="banner">REEMBOLSADA</div>`
        : "";

  const itemsRows = items
    .map(
      (it) => `
      <tr>
        <td colspan="3" class="item-name">${escapeHtml(it.product_name ?? it.product_code ?? "")}</td>
      </tr>
      <tr>
        <td>${it.quantity}</td>
        <td>${formatCurrency(it.unit_price)}</td>
        <td class="right">${formatCurrency(it.total)}</td>
      </tr>`
    )
    .join("");

  const paymentRows = payments
    .map(
      (p) =>
        `<tr><td colspan="2">${escapeHtml(p.payment_method)}</td><td class="right">${formatCurrency(p.amount)}</td></tr>`
    )
    .join("");

  const customerBlock = sale.customer_name
    ? `<div class="row">Cliente: ${escapeHtml(sale.customer_name)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Ticket #${sale.sale_number}</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 11px; max-width: 300px; margin: 0 auto; padding: 8px; color: #000; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .row { margin: 2px 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 2px; vertical-align: top; }
  .item-name { font-weight: bold; }
  .totals td { padding-top: 2px; }
  .banner { background: #c00; color: #fff; text-align: center; padding: 4px; font-weight: bold; margin: 6px 0; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(branch?.name ?? "")}</h1>
  ${branch?.address ? `<div class="center">${escapeHtml(branch.address)}</div>` : ""}
  ${branch?.phone ? `<div class="center">Tel: ${escapeHtml(branch.phone)}</div>` : ""}
  <hr />
  ${banner}
  <div class="row">Ticket #${sale.sale_number}</div>
  <div class="row">Fecha: ${escapeHtml(sale.created_at)}</div>
  <div class="row">Cajero: ${escapeHtml(sale.cashier_name ?? "")}</div>
  ${customerBlock}
  <hr />
  <table>
    <thead>
      <tr><td>Cant</td><td>P.U.</td><td class="right">Subt.</td></tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>
  <hr />
  <table class="totals">
    <tr><td colspan="2">Subtotal</td><td class="right">${formatCurrency(sale.subtotal)}</td></tr>
    <tr><td colspan="2">Descuento</td><td class="right">${formatCurrency(sale.discount_total)}</td></tr>
    <tr><td colspan="2">IVA</td><td class="right">${formatCurrency(sale.tax_total)}</td></tr>
    <tr><td colspan="2"><strong>TOTAL</strong></td><td class="right"><strong>${formatCurrency(sale.total)}</strong></td></tr>
  </table>
  <hr />
  <table>
    ${paymentRows}
  </table>
  <hr />
  <div class="center">Gracias por su compra</div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}
