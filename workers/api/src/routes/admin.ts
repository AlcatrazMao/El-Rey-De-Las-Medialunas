import { Hono } from "hono";

import { requireRole } from "../middleware/rbac";
import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /wipe-data
// Borra todos los datos transaccionales preservando el catálogo base.
// Solo admin y owner pueden ejecutarlo.
adminRoutes.post(
  "/wipe-data",
  requireRole("admin", "owner"),
  async (c) => {
    const db = c.env.DB;

    const userId = c.get("userId") ?? "";
    const user = await resolveUser(db, userId);
    if (!user) {
      return c.json({ success: false, error: "User not registered" }, 403);
    }

    // Orden correcto: hijos antes que padres para respetar FK constraints.
    // SQLite en D1 tiene FK enforcement opcional — aun así borramos en orden seguro.
    const tablesToWipe = [
      // Movimientos de caja (dependen de cash_sessions)
      "cash_movements",
      // Sesiones de caja
      "cash_sessions",
      // Items de venta (dependen de sales)
      "sale_items",
      // Pagos de venta (dependen de sales)
      "sale_payments",
      // Ventas
      "sales",
      // Movimientos de stock
      "stock_movements",
      // Lotes de inventario (dependen de products — tabla de catálogo pero son datos transaccionales)
      "inventory_batches",
      // Inventario (stock actual — se resetea junto con los movimientos)
      "inventory",
      // Clientes
      "customers",
      // Gastos
      "expenses",
      // Solicitudes de abastecimiento
      "supply_requests",
      // Items de lotes de producción (dependen de production_batches)
      // No existe tabla production_batch_items según schema
      // Lotes de producción
      "production_batches",
      // Items de órdenes de compra (dependen de purchase_orders)
      "purchase_order_items",
      // Órdenes de compra
      "purchase_orders",
      // Ofertas
      "offers",
      // Logs operativos
      "audit_log",
      "sync_log",
      // Transferencias (items antes que cabecera)
      "transfer_order_items",
      "transfer_orders",
    ];

    const statements = tablesToWipe.map((table) =>
      db.prepare(`DELETE FROM ${table}`)
    );

    await db.batch(statements);

    return c.json({
      success: true,
      data: { wiped: tablesToWipe },
    });
  }
);
