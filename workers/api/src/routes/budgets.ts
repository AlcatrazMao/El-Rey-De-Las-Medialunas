import { Hono } from "hono";
import { z } from "zod";

import { resolveUser } from "../lib/resolve-user";
import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// budgets.ts — Presupuesto (DT-9: separado de sales, no afecta stock ni caja)
// ============================================================================
//
// Esta ruta calcula subtotal/total en memoria a partir de los items pero
// jamás toca `inventory`, `stock_movements` ni `cash_movements` — un
// presupuesto es una cotización, no una operación real. `budgets` es tabla
// propia (migración 0023), sin FK hacia sales.
export const budgetsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const budgetItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().finite().positive().max(1_000_000),
  unit_price: z.number().finite().nonnegative().max(10_000_000),
});

const createBudgetSchema = z.object({
  customer_id: z.string().min(1).optional(),
  items: z.array(budgetItemSchema).min(1).max(200),
  valid_until: z.string().min(1),
});

budgetsRoutes.post("/", validate({ body: createBudgetSchema }), async (c) => {
  const db = c.env.DB;
  const branchId = c.get("branchId");
  const userId = c.get("userId") ?? "";

  if (!branchId) {
    return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
  }

  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // DT-12: el tipo debe estar habilitado en la sucursal activa (mismo patrón
  // que sales.ts). Sin esto, deshabilitar "Presupuesto" en Configuración no
  // bloqueaba la emisión.
  const settingRow = await db
    .prepare(`SELECT enabled FROM document_type_settings WHERE branch_id = ? AND document_type = ?`)
    .bind(branchId, "presupuesto")
    .first<{ enabled: number }>();
  if (!settingRow || settingRow.enabled !== 1) {
    return c.json(errBody("DOCUMENT_TYPE_DISABLED", "El tipo de comprobante 'presupuesto' no está habilitado en esta sucursal"), 409);
  }

  const {
    customer_id: customerId,
    items,
    valid_until: validUntil,
  } = c.get("validatedBody") as z.infer<typeof createBudgetSchema>;

  // Validar que los productos existan.
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const placeholders = productIds.map(() => "?").join(",");
  const productRows = await db
    .prepare(`SELECT id FROM products WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
    .bind(...productIds)
    .all<{ id: string }>();
  const foundProductIds = new Set((productRows.results ?? []).map((r) => r.id));
  const missingProduct = productIds.find((id) => !foundProductIds.has(id));
  if (missingProduct) {
    return c.json(errBody("VALIDATION_ERROR", `product_id inválido: ${missingProduct}`), 400);
  }

  if (customerId) {
    const customer = await db.prepare(`SELECT id FROM customers WHERE id = ? LIMIT 1`).bind(customerId).first();
    if (!customer) {
      return c.json(errBody("VALIDATION_ERROR", "customer_id inválido"), 400);
    }
  }

  // Cálculo en memoria — NO se persiste en sales, NO se toca inventory ni
  // cash_movements (DT-9). subtotal === total acá porque budgets no modela
  // descuentos/impuestos propios en este alcance (migración 0023 solo define
  // subtotal/total en el esquema).
  const itemsWithSubtotal = items.map((item) => ({
    ...item,
    subtotal: parseFloat((item.unit_price * item.quantity).toFixed(2)),
  }));
  const total = parseFloat(itemsWithSubtotal.reduce((acc, i) => acc + i.subtotal, 0).toFixed(2));
  const subtotal = total;

  const budgetId = genId();
  const now = nowSqliteTs();

  // FISCAL: el incremento de document_sequences se fusiona como PRIMERA
  // sentencia del mismo db.batch() que el INSERT del presupuesto (+
  // budget_items) — mismo patrón que sales.ts (ver comentario ahí). Si el
  // batch falla después, D1 revierte también el incremento (atómico, todo o
  // nada), así que no queda un hueco de numeración fiscal sin comprobante
  // real.
  //
  // DIFERENCIA vs sales.ts: acá `sale_number` SÍ hay que bindearlo dentro del
  // INSERT (columna NOT NULL de budgets), pero db.batch() no permite pasar
  // el resultado runtime de la sentencia 1 como bind param de la sentencia 2
  // — todos los binds se fijan antes de ejecutar el batch. Por eso el INSERT
  // lee el número recién actualizado con una subquery SQL sobre
  // document_sequences en vez de un valor JS bindeado.
  const sequenceUpdate = db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, "presupuesto");

  const budgetInsert = db
    .prepare(
      `INSERT INTO budgets (id, branch_id, user_id, customer_id, sale_number, valid_until, subtotal, total, status, created_at)
       VALUES (?, ?, ?, ?, (SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?), ?, ?, ?, 'open', ?)`,
    )
    .bind(budgetId, branchId, userId, customerId ?? null, branchId, "presupuesto", validUntil, subtotal, total, now);

  const stmts = [
    sequenceUpdate,
    budgetInsert,
    ...itemsWithSubtotal.map((item) =>
      db
        .prepare(
          `INSERT INTO budget_items (id, budget_id, product_id, quantity, unit_price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(genId(), budgetId, item.product_id, item.quantity, item.unit_price, item.subtotal),
    ),
  ];

  const batchResults = await db.batch(stmts);
  const sequenceResult = batchResults[0] as D1Result<{ last_number: number }>;
  const sequenceRow = sequenceResult.results?.[0];
  if (!sequenceRow) {
    throw new Error(
      `document_sequences no tiene seed para branch_id=${branchId} document_type=presupuesto — revisar migración 0023`,
    );
  }
  const budgetNumber = sequenceRow.last_number;

  return c.json(
    {
      success: true,
      data: {
        id: budgetId,
        branch_id: branchId,
        customer_id: customerId ?? null,
        sale_number: budgetNumber,
        valid_until: validUntil,
        subtotal,
        total,
        status: "open",
        created_at: now,
      },
    },
    201,
  );
});
