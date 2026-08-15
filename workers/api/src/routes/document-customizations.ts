import type { Role } from "@medialunas/shared";
import { Hono } from "hono";
import { z } from "zod";

import { DOCUMENT_TYPES } from "../lib/document-sequences";
import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// document-customizations.ts — Personalización de comprobantes (migración 0025)
// ============================================================================
//
// Dos niveles: global (document_type_customizations) y override por sucursal
// (document_type_branch_customizations). La resolución es COALESCE(branch, global).
// No toca document_sequences ni document_type_settings.enabled (DT-12).

const ADMIN_ROLES = new Set<Role>(["admin", "owner", "supervisor"]);

export const documentCustomizationsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// Columnas editables (whitelist — nunca se construye SQL con input libre).
const EDITABLE_COLUMNS = [
  "title",
  "header_text",
  "footer_text",
  "show_prices",
  "show_tax",
  "show_logo",
  "show_qr",
  "show_customer",
  "show_operator",
  "presupuesto_valid_days",
  "nota_credito_require_reason",
  "factura_fiscal_legend",
] as const;

const customizationsFields = z.object({
  title: z.string().max(120).nullable().optional(),
  header_text: z.string().max(500).nullable().optional(),
  footer_text: z.string().max(500).nullable().optional(),
  show_prices: z.boolean().optional(),
  show_tax: z.boolean().optional(),
  show_logo: z.boolean().optional(),
  show_qr: z.boolean().optional(),
  show_customer: z.boolean().optional(),
  show_operator: z.boolean().optional(),
  presupuesto_valid_days: z.number().int().min(1).max(3650).nullable().optional(),
  nota_credito_require_reason: z.boolean().optional(),
  factura_fiscal_legend: z.string().max(500).nullable().optional(),
});

const patchCustomizationSchema = z.object({
  scope: z.enum(["global", "branch"]),
  ...customizationsFields.shape,
});

const documentTypeParamSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
});

interface CustomizationRow {
  document_type?: string;
  title: string | null;
  header_text: string | null;
  footer_text: string | null;
  show_prices: number | null;
  show_tax: number | null;
  show_logo: number | null;
  show_qr: number | null;
  show_customer: number | null;
  show_operator: number | null;
  presupuesto_valid_days: number | null;
  nota_credito_require_reason: number | null;
  factura_fiscal_legend: string | null;
}

const DEFAULTS: CustomizationRow = {
  title: null,
  header_text: null,
  footer_text: null,
  show_prices: 1,
  show_tax: 0,
  show_logo: 0,
  show_qr: 0,
  show_customer: 1,
  show_operator: 1,
  presupuesto_valid_days: null,
  nota_credito_require_reason: 1,
  factura_fiscal_legend: null,
};

function toPublic(row: CustomizationRow | null) {
  return {
    title: row?.title ?? DEFAULTS.title,
    header_text: row?.header_text ?? DEFAULTS.header_text,
    footer_text: row?.footer_text ?? DEFAULTS.footer_text,
    show_prices: (row?.show_prices ?? DEFAULTS.show_prices) === 1,
    show_tax: (row?.show_tax ?? DEFAULTS.show_tax) === 1,
    show_logo: (row?.show_logo ?? DEFAULTS.show_logo) === 1,
    show_qr: (row?.show_qr ?? DEFAULTS.show_qr) === 1,
    show_customer: (row?.show_customer ?? DEFAULTS.show_customer) === 1,
    show_operator: (row?.show_operator ?? DEFAULTS.show_operator) === 1,
    presupuesto_valid_days: row?.presupuesto_valid_days ?? null,
    nota_credito_require_reason: (row?.nota_credito_require_reason ?? DEFAULTS.nota_credito_require_reason) === 1,
    factura_fiscal_legend: row?.factura_fiscal_legend ?? null,
  };
}

function resolveField<T>(branch: T | null, global: T | null, fallback: T): T {
  if (branch !== null && branch !== undefined) return branch;
  if (global !== null && global !== undefined) return global;
  return fallback;
}

// GET / — personalización resuelta para los 7 tipos, de la sucursal activa.
documentCustomizationsRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.get("branchId");

  if (!branchId) {
    return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
  }

  const globalRows = await db
    .prepare(`SELECT * FROM document_type_customizations`)
    .all<CustomizationRow>();
  const branchRows = await db
    .prepare(`SELECT * FROM document_type_branch_customizations WHERE branch_id = ?`)
    .bind(branchId)
    .all<CustomizationRow>();

  const globalByType = new Map<string, CustomizationRow>(
    (globalRows.results ?? []).map((r) => [r.document_type!, r]),
  );
  const branchByType = new Map<string, CustomizationRow>(
    (branchRows.results ?? []).map((r) => [r.document_type!, r]),
  );

  const data = DOCUMENT_TYPES.map((dt) => {
    const g = globalByType.get(dt) ?? null;
    const b = branchByType.get(dt) ?? null;
    return {
      document_type: dt,
      global: toPublic(g),
      branch: b ? toPublic(b) : null,
      resolved: {
        title: resolveField(b?.title ?? null, g?.title ?? null, null),
        header_text: resolveField(b?.header_text ?? null, g?.header_text ?? null, null),
        footer_text: resolveField(b?.footer_text ?? null, g?.footer_text ?? null, null),
        show_prices: resolveField(b?.show_prices ?? null, g?.show_prices ?? null, DEFAULTS.show_prices!) === 1,
        show_tax: resolveField(b?.show_tax ?? null, g?.show_tax ?? null, DEFAULTS.show_tax!) === 1,
        show_logo: resolveField(b?.show_logo ?? null, g?.show_logo ?? null, DEFAULTS.show_logo!) === 1,
        show_qr: resolveField(b?.show_qr ?? null, g?.show_qr ?? null, DEFAULTS.show_qr!) === 1,
        show_customer: resolveField(b?.show_customer ?? null, g?.show_customer ?? null, DEFAULTS.show_customer!) === 1,
        show_operator: resolveField(b?.show_operator ?? null, g?.show_operator ?? null, DEFAULTS.show_operator!) === 1,
        presupuesto_valid_days: resolveField(b?.presupuesto_valid_days ?? null, g?.presupuesto_valid_days ?? null, null),
        nota_credito_require_reason: resolveField(b?.nota_credito_require_reason ?? null, g?.nota_credito_require_reason ?? null, DEFAULTS.nota_credito_require_reason!) === 1,
        factura_fiscal_legend: resolveField(b?.factura_fiscal_legend ?? null, g?.factura_fiscal_legend ?? null, null),
      },
    };
  });

  return c.json({ success: true, data });
});

// PATCH /:documentType — escribe personalización en el scope indicado.
// scope='global' → tabla global; scope='branch' → override de sucursal activa.
documentCustomizationsRoutes.patch(
  "/:documentType",
  validate({ params: documentTypeParamSchema, body: patchCustomizationSchema }),
  async (c) => {
    const db = c.env.DB;
    const branchId = c.get("branchId");
    const userRole = c.get("userRole") as Role | undefined;

    if (!branchId) {
      return c.json(errBody("VALIDATION_ERROR", "No se pudo resolver la sucursal activa"), 400);
    }
    if (!userRole || !ADMIN_ROLES.has(userRole)) {
      return c.json(errBody("FORBIDDEN", "No tenés permisos para modificar la personalización de comprobantes"), 403);
    }

    const { documentType } = c.get("validatedParams") as z.infer<typeof documentTypeParamSchema>;
    const body = c.get("validatedBody") as z.infer<typeof patchCustomizationSchema>;

    // Solo columnas presentes en el body (whitelist). Para 'branch', null =
    // heredar del global; para 'global', null = resetear al default.
    const entries = EDITABLE_COLUMNS.filter((col) => col in body && body[col as keyof typeof body] !== undefined);
    if (entries.length === 0) {
      return c.json(errBody("VALIDATION_ERROR", "No se enviaron campos para actualizar"), 400);
    }

    const setClause = entries.map((col) => `${col} = ?`).join(", ");
    const values = entries.map((col) => {
      const v = body[col as keyof typeof body];
      if (typeof v === "boolean") return v ? 1 : 0;
      return v ?? null;
    });

    const now = nowSqliteTs();

    if (body.scope === "branch") {
      const keyCols = entries.map((col) => `${col} = excluded.${col}`).join(", ");
      await db
        .prepare(
          `INSERT INTO document_type_branch_customizations (branch_id, document_type, ${entries.join(", ")}, updated_at)
           VALUES (?, ?, ${entries.map(() => "?").join(", ")}, ?)
           ON CONFLICT(branch_id, document_type) DO UPDATE SET ${keyCols}, updated_at = excluded.updated_at`,
        )
        .bind(branchId, documentType, ...values, now)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE document_type_customizations SET ${setClause}, updated_at = ? WHERE document_type = ?`,
        )
        .bind(...values, now, documentType)
        .run();
    }

    return c.json({ success: true, data: { document_type: documentType, scope: body.scope } });
  },
);
