import type { Role } from "@medialunas/shared";
import { Hono } from "hono";
import { z } from "zod";

import { DOCUMENT_TYPES } from "../lib/document-sequences";
import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// document-settings.ts — Toggles de habilitación por tipo de comprobante
// ============================================================================
//
// Separado a propósito de document-sequences.ts: esta ruta NUNCA debe tocar
// document_sequences.last_number (DT-12). El toggle vive en su propia tabla
// (document_type_settings) desde la migración 0023 justamente para que sea
// estructuralmente imposible que un PATCH acá afecte la numeración.
//
// Mismo patrón ADMIN_ROLES que transfers.ts (roles con permiso de
// aprobar/rechazar traslados) — acá se reusa para "quién puede togglear qué
// tipos de comprobante emite la sucursal".
const ADMIN_ROLES = new Set<Role>(["admin", "owner", "supervisor"]);

export const documentSettingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const patchSettingSchema = z.object({
  enabled: z.boolean(),
});

const documentTypeParamSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
});

// GET / — toggles de las 7 combinaciones para la sucursal activa (branchId
// resuelto por resolveBranchScope, montado globalmente en app.ts).
documentSettingsRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.get("branchId");

  if (!branchId) {
    return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
  }

  const rows = await db
    .prepare(
      `SELECT document_type, enabled FROM document_type_settings WHERE branch_id = ?`,
    )
    .bind(branchId)
    .all<{ document_type: string; enabled: number }>();

  const data = (rows.results ?? []).map((r) => ({
    document_type: r.document_type,
    enabled: r.enabled === 1,
  }));

  return c.json({ success: true, data });
});

// PATCH /:documentType — togglea enabled para un tipo puntual. Guard de rol
// admin/owner/supervisor. NUNCA escribe sobre document_sequences.
documentSettingsRoutes.patch(
  "/:documentType",
  validate({ params: documentTypeParamSchema, body: patchSettingSchema }),
  async (c) => {
    const db = c.env.DB;
    const branchId = c.get("branchId");
    const userId = c.get("userId") ?? "";
    const userRole = c.get("userRole") as Role | undefined;

    if (!branchId) {
      return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
    }

    if (!userRole || !ADMIN_ROLES.has(userRole)) {
      return c.json(errBody("FORBIDDEN", "No tenés permisos para modificar tipos de comprobante"), 403);
    }

    const { documentType } = c.get("validatedParams") as z.infer<typeof documentTypeParamSchema>;
    const { enabled } = c.get("validatedBody") as z.infer<typeof patchSettingSchema>;

    const now = nowSqliteTs();

    // Solo toca document_type_settings.enabled — jamás document_sequences (DT-12).
    const result = await db
      .prepare(
        `UPDATE document_type_settings
           SET enabled = ?, updated_at = ?, updated_by = ?
         WHERE branch_id = ? AND document_type = ?`,
      )
      .bind(enabled ? 1 : 0, now, userId, branchId, documentType)
      .run();

    if (result.meta.changes === 0) {
      return c.json(errBody("NOT_FOUND", "No existe configuración para ese tipo de comprobante en esta sucursal"), 404);
    }

    return c.json({ success: true, data: { document_type: documentType, enabled } });
  },
);
