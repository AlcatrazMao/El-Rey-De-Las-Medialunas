import type { D1Database } from "@cloudflare/workers-types";

import { nowSqliteTs } from "../utils/time";

/**
 * 15 tipos de comprobantes AFIP/ARCA y operativos soportados (migración 0029).
 * Usado para CHECK de document_sequences / document_type_settings / document_type_customizations
 * y para validar inputs en todas las rutas del sistema.
 */
export const DOCUMENT_TYPES = [
  "ticket",
  "factura_a",
  "factura_b",
  "factura_c",
  "factura_m",
  "nota_credito_a",
  "nota_credito_b",
  "nota_credito_c",
  "nota_credito_m",
  "nota_debito_a",
  "nota_debito_b",
  "nota_debito_c",
  "nota_debito_m",
  "presupuesto",
  "remito",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Helper compartido de numeración correlativa por (branch_id, document_type).
 *
 * Atómico a nivel de sentencia D1 vía UPDATE...RETURNING: no hace falta
 * retry-loop. Bajo concurrencia, D1/SQLite serializa los UPDATE sobre la misma fila,
 * garantizando correlatividad estricta sin huecos ni colisiones.
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
      `document_sequences no tiene seed para branch_id=${branchId} document_type=${documentType} — revisar migración 0029`,
    );
  }

  return row.last_number;
}

/**
 * Helper de solo lectura de la secuencia actual por (branch_id, document_type).
 */
export async function getDocumentSequence(
  db: D1Database,
  branchId: string,
  documentType: DocumentType,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?`,
    )
    .bind(branchId, documentType)
    .first<{ last_number: number }>();

  if (!row) {
    throw new Error(
      `document_sequences no tiene seed para branch_id=${branchId} document_type=${documentType} — revisar migración 0029`,
    );
  }

  return row.last_number;
}
