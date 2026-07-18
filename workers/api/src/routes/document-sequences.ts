import { Hono } from "hono";
import { z } from "zod";

import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// document-sequences.ts — Bootstrap de numeración legacy (migración de Ticket)
// ============================================================================
//
// DT-4: `pan_erp_invoice_seq` (localStorage, por dispositivo/caja) debe
// migrar a `document_sequences` como secuencia inicial de 'ticket', sin
// reiniciar ni duplicar. Como cada caja del POS tiene su propio contador de
// localStorage y pueden reportar en momentos distintos, el mecanismo de
// bootstrap NO puede ser "una sola llamada gana y las demás se rechazan":
// eso dejaría el número final en manos de qué caja llame primero, no de cuál
// tiene el contador legacy más alto — perdiendo continuidad numérica para
// las demás cajas (justo lo que DT-4 exige evitar).
//
// DECISIÓN DE DISEÑO (reemplaza el guard "solo si last_number actual es 0 /
// 409 si no" sugerido inicialmente en el plan): en vez de un guard de
// "una sola vez", el UPDATE es monótono e idempotente —
//
//   UPDATE document_sequences
//      SET last_number = MAX(last_number, ?), updated_at = ?
//    WHERE branch_id = ? AND document_type = ? AND last_number < ?
//
// — con el filtro `AND last_number < ?` como no-op guard: si el valor
// reportado no es mayor al actual, la sentencia no hace nada (0 rows
// affected), pero NO es un error. Cualquier cantidad de cajas puede llamar
// en cualquier orden: cada una empuja el contador hacia arriba solo si su
// valor reportado es mayor, y el resultado final converge al MAX real de
// todas las cajas sin necesidad de coordinarlas ni de "cerrar" el bootstrap
// explícitamente. Nunca puede bajar el contador (protege contra un cliente
// con un valor legacy corrupto/bajo). No requiere rol elevado: cualquier
// usuario autenticado de la sucursal puede reportar su valor legacy.
export const documentSequencesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const bootstrapSchema = z.object({
  document_type: z.literal("ticket"),
  last_number: z.number().int().nonnegative(),
});

// POST /bootstrap — reporta el último número conocido de la secuencia legacy
// de Ticket (pan_erp_invoice_seq) para esta sucursal. Idempotente y
// acumulativo: toma el MAX entre lo que ya había y lo reportado, nunca baja.
documentSequencesRoutes.post("/bootstrap", validate({ body: bootstrapSchema }), async (c) => {
  const db = c.env.DB;
  const branchId = c.get("branchId");

  if (!branchId) {
    return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
  }

  const { document_type: documentType, last_number: lastNumber } = c.get("validatedBody") as z.infer<
    typeof bootstrapSchema
  >;

  const now = nowSqliteTs();

  const result = await db
    .prepare(
      `UPDATE document_sequences
          SET last_number = MAX(last_number, ?), updated_at = ?
        WHERE branch_id = ? AND document_type = ? AND last_number < ?`,
    )
    .bind(lastNumber, now, branchId, documentType, lastNumber)
    .run();

  const row = await db
    .prepare(`SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?`)
    .bind(branchId, documentType)
    .first<{ last_number: number }>();

  if (!row) {
    return c.json(errBody("NOT_FOUND", "No existe secuencia para esa sucursal/tipo — revisar migración 0023"), 404);
  }

  return c.json({
    success: true,
    data: {
      document_type: documentType,
      last_number: row.last_number,
      updated: result.meta.changes > 0,
    },
  });
});
