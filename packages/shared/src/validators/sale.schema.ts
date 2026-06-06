import { z } from "zod";

const hexId = z.string().regex(
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i,
  "ID inválido"
);

const paymentMethodEnum = z.enum([
  "cash",
  "credit_card",
  "debit_card",
  "transfer",
  "digital_wallet",
]);

export const saleItemSchema = z.object({
  product_id: hexId,
  batch_id: hexId.optional().nullable(),
  quantity: z
    .number()
    .positive("La cantidad debe ser mayor a 0")
    .finite("Cantidad inválida"),
  unit_price: z
    .number()
    .min(0, "El precio unitario no puede ser negativo")
    .finite("Precio inválido"),
  discount: z
    .number()
    .min(0, "El descuento no puede ser negativo")
    .max(100, "El descuento no puede exceder 100%")
    .default(0),
  tax_rate: z
    .number()
    .min(0, "El impuesto no puede ser negativo")
    .max(100, "El impuesto no puede exceder 100%")
    .default(21.0),
  notes: z.string().max(500).optional().nullable(),
});

export const salePaymentSchema = z.object({
  payment_method: paymentMethodEnum,
  amount: z
    .number()
    .positive("El monto debe ser mayor a 0")
    .finite("Monto inválido"),
  reference: z.string().max(200).optional().nullable(),
});

export const createSaleSchema = z
  .object({
    branch_id: hexId,
    customer_id: hexId.optional().nullable(),
    items: z
      .array(saleItemSchema)
      .min(1, "La venta debe tener al menos un ítem")
      .max(200, "Máximo 200 ítems por venta"),
    payments: z
      .array(salePaymentSchema)
      .min(1, "La venta debe tener al menos un pago")
      .max(10, "Máximo 10 pagos por venta"),
    notes: z.string().max(1000).optional().nullable(),
  })
  .strict()
  .refine(
    (data) => {
      const totalAmount = data.items.reduce(
        (sum, item) =>
          sum + item.quantity * item.unit_price * (1 - item.discount / 100),
        0,
      );
      const totalPaid = data.payments.reduce((sum, p) => sum + p.amount, 0);
      return Math.abs(totalAmount - totalPaid) < 0.01;
    },
    {
      message: "El total de pagos no coincide con el total de la venta",
      path: ["payments"],
    },
  );

export const voidSaleSchema = z.object({
  reason: z
    .string()
    .min(1, "La razón de anulación es requerida")
    .max(500, "Máximo 500 caracteres"),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type SalePaymentInput = z.infer<typeof salePaymentSchema>;
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;
