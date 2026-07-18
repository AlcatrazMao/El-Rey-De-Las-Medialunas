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

const createCreditNoteSchema = z.object({
  sale_id: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  amount: z.number().finite().positive(),
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

  const { sale_id: saleId, reason, amount } = c.get("validatedBody") as z.infer<typeof createCreditNoteSchema>;

  // DT-7: la venta debe existir y pertenecer a la misma sucursal — nunca se
  // crea una nota de crédito sin venta real, ni cross-branch.
  const sale = await db
    .prepare(`SELECT id, sale_number FROM sales WHERE id = ? AND branch_id = ? LIMIT 1`)
    .bind(saleId, branchId)
    .first<{ id: string; sale_number: number }>();

  if (!sale) {
    return c.json(errBody("VALIDATION_ERROR", "sale_id no corresponde a una venta válida de esta sucursal"), 400);
  }

  const id = genId();
  const now = nowSqliteTs();

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
    .bind(id, branchId, saleId, userId, branchId, "nota_credito", reason, amount, now);

  const batchResults = await db.batch([sequenceUpdate, creditNoteInsert]);
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
        sale_id: saleId,
        sale_number: creditNoteNumber,
        reason,
        amount,
        created_at: now,
      },
    },
    201,
  );
});
