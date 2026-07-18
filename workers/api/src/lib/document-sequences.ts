import type { D1Database } from "@cloudflare/workers-types";

import { nowSqliteTs } from "../utils/time";

/**
 * 7 tipos de comprobante soportados (migración 0023). Usado tanto para el
 * CHECK de document_sequences/document_type_settings como para validar
 * inputs de rutas que aceptan cualquiera de los 7 (document-settings,
 * document-sequences/bootstrap). Las rutas de `sales` solo permiten un
 * subconjunto de 4 (ver DOCUMENT_TYPES_SALES en routes/sales.ts).
 */
export const DOCUMENT_TYPES = [
  "ticket",
  "factura_a",
  "factura_b",
  "factura_c",
  "nota_credito",
  "remito",
  "presupuesto",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Helper compartido de numeración correlativa por (branch_id, document_type).
 *
 * Atómico a nivel de sentencia D1 vía UPDATE...RETURNING: no hace falta
 * retry-loop (a diferencia de sales.sale_number legacy, que usa
 * SELECT MAX+1 + retry porque no tenía una tabla de secuencia dedicada).
 * Bajo concurrencia, D1/SQLite serializa los UPDATE sobre la misma fila, así
 * que dos llamadas simultáneas para el mismo branch+tipo nunca devuelven el
 * mismo last_number (DT-1, DT-2).
 *
 * Si no devuelve fila, significa que falta el seed para esa combinación
 * branch/tipo — no debería pasar si la migración 0023 corrió bien (siembra
 * las 7 combinaciones por cada branch existente). Lanzamos para que el
 * caller no numere "en el aire" sin persistencia real.
 */
export async function nextSequence(
  db: D1Database,
  branchId: string,
  documentType: DocumentType,
): Promise<number> {
  const now = nowSqliteTs();
  const row = await db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, documentType)
    .first<{ last_number: number }>();

  if (!row) {
    throw new Error(
      `document_sequences no tiene seed para branch_id=${branchId} document_type=${documentType} — revisar migración 0023`,
    );
  }

  return row.last_number;
}
