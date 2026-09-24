import { z } from "zod";

const hexId = z.string().regex(
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i,
  "ID inválido"
);

export const unitEnum = z.enum(["unit", "kg", "g", "l", "ml", "dozen", "pack"]);

export const createProductSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/).optional(),
    initial_stock: z.number().finite().min(0).max(10000000).optional(),
    supplier: z.string().max(2000).nullable().optional(),
    attributes: z.string().max(2000).nullable().optional(),
    shelf_life_days: z.number().int().min(0).max(36500).nullable().optional(),
    storage_instructions: z.string().max(2000).nullable().optional(),
    code: z
      .string()
      .min(1, "El código es requerido")
      .max(50, "El código no puede exceder 50 caracteres"),
    barcode: z
      .string()
      .max(128, "El código de barras no puede exceder 128 caracteres")
      .optional()
      .nullable(),
    name: z
      .string()
      .min(1, "El nombre es requerido")
      .max(200, "El nombre no puede exceder 200 caracteres"),
    description: z.string().max(2000).optional().nullable(),
    image_url: z.string().url().optional().nullable(),
    thumbnail_url: z.string().url().optional().nullable(),
    category_id: hexId,
    branch_id: hexId,
    unit: unitEnum.default("unit"),
    price: z
      .number()
      .min(0, "El precio no puede ser negativo")
      .finite("Precio inválido"),
    cost: z
      .number()
      .min(0, "El costo no puede ser negativo")
      .finite("Costo inválido")
      .default(0),
    tax_rate: z
      .number()
      .min(0, "El impuesto no puede ser negativo")
      .max(100, "El impuesto no puede exceder 100%")
      .default(21.0),
    min_stock: z
      .number()
      .min(0, "El stock mínimo no puede ser negativo")
      .default(0),
    max_stock: z
      .number()
      .min(0, "El stock máximo no puede ser negativo")
      .default(999999),
    track_inventory: z.boolean().default(true),
    is_producible: z.boolean().default(false),
    is_raw_material: z.boolean().default(false),
    is_active: z.boolean().default(true),
  })
  .strict();

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
