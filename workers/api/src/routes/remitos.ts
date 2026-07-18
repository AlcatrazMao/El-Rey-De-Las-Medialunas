import { Hono } from "hono";
import { z } from "zod";

import { resolveUser } from "../lib/resolve-user";
import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// remitos.ts — Remito (DT-8: solo traslado de mercadería, sin valor comercial)
// ============================================================================
//
// remito_items NO tiene columnas de precio/IVA/total (migración 0023) — a
// propósito. Esta ruta tampoco calcula ni persiste ningún monto: solo
// cantidades y descripción.
export const remitosRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const remitoItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().finite().positive().max(1_000_000),
  description: z.string().max(500).optional(),
});

const createRemitoSchema = z.object({
  customer_id: z.string().min(1).optional(),
  items: z.array(remitoItemSchema).min(1).max(200),
  notes: z.string().max(1000).optional(),
});

remitosRoutes.post("/", validate({ body: createRemitoSchema }), async (c) => {
  const db = c.env.DB;
  const branchId = c.get("branchId");
  const userId = c.get("userId") ?? "";

  if (!branchId) {
    return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
  }

  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const { customer_id: customerId, items, notes } = c.get("validatedBody") as z.infer<typeof createRemitoSchema>;

  // Validar que los productos existan (mismo patrón que transfers.ts).
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

  const remitoId = genId();
  const now = nowSqliteTs();

  // FISCAL: el incremento de document_sequences se fusiona como PRIMERA
  // sentencia del mismo db.batch() que el INSERT del remito (+ remito_items)
  // — mismo patrón que sales.ts (ver comentario ahí). Si el batch falla
  // después, D1 revierte también el incremento (atómico, todo o nada), así
  // que no queda un hueco de numeración fiscal sin comprobante real.
  //
  // DIFERENCIA vs sales.ts: acá `sale_number` SÍ hay que bindearlo dentro del
  // INSERT (columna NOT NULL de remitos), pero db.batch() no permite pasar el
  // resultado runtime de la sentencia 1 como bind param de la sentencia 2 —
  // todos los binds se fijan antes de ejecutar el batch. Por eso el INSERT
  // lee el número recién actualizado con una subquery SQL sobre
  // document_sequences en vez de un valor JS bindeado.
  const sequenceUpdate = db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, "remito");

  const remitoInsert = db
    .prepare(
      `INSERT INTO remitos (id, branch_id, user_id, customer_id, sale_number, notes, created_at)
       VALUES (?, ?, ?, ?, (SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?), ?, ?)`,
    )
    .bind(remitoId, branchId, userId, customerId ?? null, branchId, "remito", notes ?? null, now);

  const stmts = [
    sequenceUpdate,
    remitoInsert,
    ...items.map((item) =>
      db
        .prepare(
          `INSERT INTO remito_items (id, remito_id, product_id, quantity, description)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(genId(), remitoId, item.product_id, item.quantity, item.description ?? null),
    ),
  ];

  const batchResults = await db.batch(stmts);
  const sequenceResult = batchResults[0] as D1Result<{ last_number: number }>;
  const sequenceRow = sequenceResult.results?.[0];
  if (!sequenceRow) {
    throw new Error(
      `document_sequences no tiene seed para branch_id=${branchId} document_type=remito — revisar migración 0023`,
    );
  }
  const remitoNumber = sequenceRow.last_number;

  return c.json(
    {
      success: true,
      data: {
        id: remitoId,
        branch_id: branchId,
        customer_id: customerId ?? null,
        sale_number: remitoNumber,
        notes: notes ?? null,
        created_at: now,
      },
    },
    201,
  );
});
