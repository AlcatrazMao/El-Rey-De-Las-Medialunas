import { Hono } from "hono";

import { resolveUser } from "../lib/resolve-user";
import { requireRole } from "../middleware/rbac";
import type { Env, Variables } from "../types/bindings";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// SECURITY: explicit whitelist of tables that wipe-data is allowed to touch.
// Even though the array below is hardcoded today, we validate every entry
// against this whitelist before interpolating it into a DELETE statement, so
// that any future refactor that turns it into a dynamic value still cannot
// hit other tables (defense-in-depth against SQL injection via table name).
const WIPEABLE_TABLES = new Set<string>([
  "cash_movements",
  "cash_sessions",
  "sale_items",
  "sale_payments",
  "sales",
  "stock_movements",
  "inventory_batches",
  "inventory",
  "customers",
  "expenses",
  "supply_requests",
  "production_batches",
  "purchase_order_items",
  "purchase_orders",
  "offers",
  "audit_log",
  "sync_log",
  "transfer_order_items",
  "transfer_orders",
]);

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
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } },
        403,
      );
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

    // SECURITY: hard validation — every table name MUST be in the whitelist
    // before we interpolate it into a DELETE statement. This is belt-and-
    // suspenders against accidental misuse of dynamic table names.
    for (const table of tablesToWipe) {
      if (!WIPEABLE_TABLES.has(table)) {
        console.error(`[admin/wipe-data] attempted to wipe non-whitelisted table: ${table}`);
        return c.json(
          {
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Configuración de wipe-data inválida",
            },
          },
          500,
        );
      }
    }

    try {
      const statements = tablesToWipe.map((table) =>
        db.prepare(`DELETE FROM ${table}`),
      );

      await db.batch(statements);
    } catch (err) {
      console.error("[admin/wipe-data] failed:", err);
      return c.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Error al ejecutar wipe-data",
          },
        },
        500,
      );
    }

    return c.json({
      success: true,
      data: { wiped: tablesToWipe },
    });
  },
);
