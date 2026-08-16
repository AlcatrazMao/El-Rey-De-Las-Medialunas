import { Hono } from "hono";
import { z } from "zod";

import { resolveUser } from "../lib/resolve-user";
import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// credit-notes.ts — Nota de Crédito (DT-7: siempre atada a una venta real)
// ============================================================================
//
// credit_notes.sale_id es NOT NULL a nivel de esquema (migración 0023), pero
// igual validamos acá ANTES de incrementar la secuencia fiscal para no gastar
// numeración en un intento inválido, y para devolver un 400 claro
// (VALIDATION_ERROR) en vez de dejar que el INSERT reviente por el FK.
export const creditNotesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const createCreditNoteSchema = z
  .object({
    // Modo A (referenciando venta): sale_id + amount. DT-7 original.
    sale_id: z.string().min(1).optional(),
    // `reason` es opcional acá: su obligatoriedad se resuelve en el handler
    // según `nota_credito_require_reason` (personalización por sucursal/global).
    reason: z.string().trim().max(500).optional(),
    amount: z.number().finite().positive().optional(),
    // Modo B (devolución standalone desde carrito): items + cash_session_id.
    cash_session_id: z.string().min(1).optional(),
    items: z
      .array(
        z.object({
          product_id: z.string().min(1),
          quantity: z.number().finite().positive(),
          unit_price: z.number().finite().min(0),
          batch_id: z.string().optional(),
        }),
      )
      .optional(),
  })
  .superRefine((v, ctx) => {
    const isStandalone = !v.sale_id;
    if (isStandalone) {
      if (!v.items || v.items.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "items es requerido para una nota de crédito sin venta referenciada" });
      }
      if (!v.cash_session_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cash_session_id"], message: "cash_session_id es requerido para descontar de la caja" });
      }
    } else if (!v.amount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "amount es requerido al referenciar una venta" });
    }
  });

creditNotesRoutes.post("/", validate({ body: createCreditNoteSchema }), async (c) => {
  const db = c.env.DB;
  const branchId = c.get("branchId");
  const userId = c.get("userId") ?? "";

  if (!branchId) {
    return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
  }

  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // DT-12: el tipo debe estar habilitado en la sucursal activa (mismo patrón
  // que sales.ts). Sin esto, deshabilitar "Nota de crédito" en Configuración
  // no bloqueaba la emisión (el toggle era solo visual para este tipo).
  const settingRow = await db
    .prepare(`SELECT enabled FROM document_type_settings WHERE branch_id = ? AND document_type = ?`)
    .bind(branchId, "nota_credito")
    .first<{ enabled: number }>();
  if (!settingRow || settingRow.enabled !== 1) {
    return c.json(errBody("DOCUMENT_TYPE_DISABLED", "El tipo de comprobante 'nota_credito' no está habilitado en esta sucursal"), 409);
  }

  const { sale_id: saleId, reason, amount, cash_session_id: cashSessionId, items } = c.get("validatedBody") as z.infer<typeof createCreditNoteSchema>;

  // Obligatoriedad del motivo: override por sucursal > global > default true
  // (migración 0025, campo nota_credito_require_reason).
  const globalReason = await db
    .prepare("SELECT nota_credito_require_reason FROM document_type_customizations WHERE document_type = 'nota_credito'")
    .first<{ nota_credito_require_reason: number | null }>();
  const branchReason = await db
    .prepare("SELECT nota_credito_require_reason FROM document_type_branch_customizations WHERE branch_id = ? AND document_type = 'nota_credito'")
    .bind(branchId)
    .first<{ nota_credito_require_reason: number | null }>();
  const requireReason = (branchReason?.nota_credito_require_reason ?? globalReason?.nota_credito_require_reason ?? 1) === 1;

  const finalReason = reason?.trim() ?? '';
  if (requireReason && !finalReason) {
    return c.json(errBody("VALIDATION_ERROR", "El motivo es obligatorio para esta nota de crédito"), 400);
  }

  const id = genId();
  const now = nowSqliteTs();

  let resolvedAmount: number;
  let itemsToReturn: Array<{ product_id: string; quantity: number; unit_price: number; batch_id?: string }> = [];

  if (saleId) {
    // Modo A: referenciando una venta — sin reversión de stock/caja (la venta
    // original ya impactó stock/caja al momento de emitirse; la nota solo deja
    // constancia del ajuste). DT-7: la venta debe existir en esta sucursal.
    const sale = await db
      .prepare(`SELECT id, sale_number FROM sales WHERE id = ? AND branch_id = ? LIMIT 1`)
      .bind(saleId, branchId)
      .first<{ id: string; sale_number: number }>();

    if (!sale) {
      return c.json(errBody("VALIDATION_ERROR", "sale_id no corresponde a una venta válida de esta sucursal"), 400);
    }
    resolvedAmount = amount!;
  } else {
    // Modo B: devolución standalone desde el carrito. El monto se CALCULA acá
    // (suma cantidad×precio) — nunca se confía en un `amount` del cliente.
    // Valida sesión de caja abierta para poder descontar el egreso.
    //
    // SECURITY: la devolución revierte caja (cash_movements 'expense') — exige
    // rol elevado, igual que cash.ts para movimientos de tipo expense. Sin esta
    // guarda, un cajero podría drenar la caja con devoluciones falsas.
    const userRole = c.get("userRole");
    if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
      return c.json(errBody("FORBIDDEN", "No tenés permisos para emitir una devolución que descuenta de la caja"), 403);
    }

    const session = await db
      .prepare("SELECT id, status FROM cash_sessions WHERE id = ? LIMIT 1")
      .bind(cashSessionId!)
      .first<{ id: string; status: string }>();

    if (!session) {
      return c.json(errBody("NOT_FOUND", "Sesión de caja no encontrada"), 404);
    }
    if (session.status !== "open") {
      return c.json(errBody("CONFLICT", "La sesión de caja no está abierta"), 409);
    }

    itemsToReturn = items!;
    resolvedAmount = parseFloat(
      itemsToReturn.reduce((acc, it) => acc + it.quantity * it.unit_price, 0).toFixed(2),
    );
    if (!(resolvedAmount > 0)) {
      return c.json(errBody("VALIDATION_ERROR", "El total de la devolución debe ser mayor a 0"), 400);
    }
  }

  // FISCAL: el incremento de document_sequences se fusiona como PRIMERA
  // sentencia del mismo db.batch() que el INSERT de la nota de crédito —
  // mismo patrón que sales.ts (ver comentario ahí). Si el batch falla
  // después, D1 revierte también el incremento (atómico, todo o nada), así
  // que no queda un hueco de numeración fiscal sin comprobante real.
  //
  // DIFERENCIA vs sales.ts: acá `sale_number` SÍ hay que bindearlo dentro del
  // INSERT (columna NOT NULL de credit_notes), pero db.batch() no permite
  // pasar el resultado runtime de la sentencia 1 como bind param de la
  // sentencia 2 — todos los binds se fijan antes de ejecutar el batch. Por
  // eso el INSERT lee el número recién actualizado con una subquery SQL
  // sobre document_sequences en vez de un valor JS bindeado, manteniendo todo
  // dentro de la misma sentencia/batch atómico.
  const sequenceUpdate = db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, "nota_credito");

  const creditNoteInsert = db
    .prepare(
      `INSERT INTO credit_notes (id, branch_id, sale_id, user_id, sale_number, reason, amount, created_at)
       VALUES (?, ?, ?, ?, (SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?), ?, ?, ?)`,
    )
    .bind(id, branchId, saleId ?? null, userId, branchId, "nota_credito", finalReason, resolvedAmount, now);

  const batchStmts = [sequenceUpdate, creditNoteInsert];

  // Modo B: reversión de stock (return_in + inventory + batch) y egreso de caja.
  if (itemsToReturn.length > 0) {
    for (const item of itemsToReturn) {
      batchStmts.push(
        db
          .prepare(
            `INSERT INTO credit_note_items (id, credit_note_id, product_id, quantity, unit_price, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(genId(), id, item.product_id, item.quantity, item.unit_price, now),
      );
      batchStmts.push(
        db
          .prepare(
            `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
             VALUES (?, ?, ?, 'return_in', ?, 'Nota de crédito', ?, ?)`,
          )
          .bind(genId(), item.product_id, branchId, item.quantity, userId, now),
      );
      batchStmts.push(
        db
          .prepare(
            `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
             WHERE product_id = ? AND branch_id = ?`,
          )
          .bind(item.quantity, now, item.product_id, branchId),
      );
      if (item.batch_id) {
        batchStmts.push(
          db
            .prepare(`UPDATE inventory_batches SET remaining_quantity = remaining_quantity + ? WHERE id = ?`)
            .bind(item.quantity, item.batch_id),
        );
      }
    }

    batchStmts.push(
      db
        .prepare(
          `INSERT INTO cash_movements (id, cash_session_id, user_id, type, amount, description, category, created_at)
           VALUES (?, ?, ?, 'expense', ?, ?, 'nota_credito', ?)`,
        )
        .bind(genId(), cashSessionId!, userId, resolvedAmount, (finalReason ? `Nota de crédito: ${finalReason}` : 'Nota de crédito').slice(0, 200), now),
    );
  }

  const batchResults = await db.batch(batchStmts);
  const sequenceResult = batchResults[0] as D1Result<{ last_number: number }>;
  const sequenceRow = sequenceResult.results?.[0];
  if (!sequenceRow) {
    throw new Error(
      `document_sequences no tiene seed para branch_id=${branchId} document_type=nota_credito — revisar migración 0023`,
    );
  }
  const creditNoteNumber = sequenceRow.last_number;

  return c.json(
    {
      success: true,
      data: {
        id,
        branch_id: branchId,
        sale_id: saleId ?? null,
        sale_number: creditNoteNumber,
        reason: finalReason,
        amount: resolvedAmount,
        created_at: now,
      },
    },
    201,
  );
});
