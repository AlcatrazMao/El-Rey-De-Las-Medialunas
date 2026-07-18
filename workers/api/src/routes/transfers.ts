import { hasPermission } from "@medialunas/shared";
import type { Role } from "@medialunas/shared";
import { Hono } from "hono";
import { z } from "zod";

import { resolveUser } from "../lib/resolve-user";
import { validate } from "../middleware/validate";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

// ============================================================================
// transfers.ts — Multi-Branch Stock Transfers (Fase 2: API core)
// ============================================================================
//
// Scaffold standalone: NO se monta en index.ts todavía (tarea 3.1, fuera de
// alcance de esta fase). Provee el ciclo de vida completo de un traslado de
// stock entre sucursales:
//
//   pending --(approve)--> approved --(ship)--> in_transit --(receive)--> received/completed
//        \--(reject)--> rejected
//
// RBAC (via PERMISSIONS de @medialunas/shared, module 'transfers'):
//   - Roles operativos (cashier/production/warehouse/driver): create + update
//     (update cubre ship/receive sobre SU sucursal). NO pueden approve/reject.
//   - admin/owner/supervisor: create + update + delete (delete no se usa acá,
//     pero approve/reject quedan reservados a estos 3 roles por regla de
//     negocio explícita del plan, más estricta que el permiso genérico).
//
// DESVIACIÓN DE SCHEMA vs plan original (confirmado leyendo migrations/):
//   - Las columnas de branch son `source_branch_id` / `destination_branch_id`
//     (no "source"/"destination" a secas).
//   - `inventory` usa `current_quantity` + `min_stock` (no "min_quantity").
//   - `transfer_orders.status` CHECK ya contempla exactamente:
//     pending, approved, rejected, in_transit, received, completed — usamos
//     'received' como estado final tras el receive (no agregamos 'completed'
//     por ahora: no hay un paso adicional de conciliación en el plan que
//     justifique diferenciar received vs completed).
//   - `stock_movements.movement_type` YA incluía 'transfer_in'/'transfer_out'
//     desde 0001 — NO hizo falta ninguna migración nueva para esto.
//   - `transfer_order_items.received_quantity` ya existe (REAL, nullable).
//
// Roles operativos: se fuerza su propia sucursal (default_branch del token),
// igual que el patrón ya establecido en middleware/auth.ts (resolveBranchScope).
const OPERATIONAL_ROLES = new Set<Role>(["cashier", "production", "warehouse", "driver"]);
const ADMIN_ROLES = new Set<Role>(["admin", "owner", "supervisor"]);

export const transfersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// ─── Zod schemas ────────────────────────────────────────────────────────────
const createItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().finite().positive().max(1_000_000),
});

const createTransferSchema = z.object({
  source_branch_id: z.string().min(1).optional(),
  destination_branch_id: z.string().min(1),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(createItemSchema).min(1).max(200),
});

const rejectSchema = z.object({
  rejection_reason: z.string().trim().min(3).max(500).optional().nullable(),
});

const recommendationsQuerySchema = z.object({
  branch_id: z.string().min(1),
  // Margen mínimo de superávit por encima de min_stock para considerar una
  // sucursal como origen candidato (evita sugerir traslados que dejarían al
  // origen también en zona de quiebre). Configurable, default razonable.
  margin: z.coerce.number().finite().nonnegative().max(1_000_000).optional(),
});

// ─── Tipos de filas ─────────────────────────────────────────────────────────
interface TransferOrderRow {
  id: string;
  source_branch_id: string;
  destination_branch_id: string;
  requested_by: string;
  approved_by: string | null;
  shipped_by: string | null;
  received_by: string | null;
  status: string;
  notes: string | null;
  requested_at: string;
  approved_at: string | null;
  shipped_at: string | null;
  received_at: string | null;
}

interface TransferOrderItemRow {
  id: string;
  transfer_order_id: string;
  product_id: string;
  quantity: number;
  received_quantity: number | null;
  notes: string | null;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Trae un transfer_order por id, o null si no existe. */
async function fetchTransferOrder(db: D1Database, id: string): Promise<TransferOrderRow | null> {
  return db
    .prepare(
      `SELECT id, source_branch_id, destination_branch_id, requested_by, approved_by,
              shipped_by, received_by, status, notes, requested_at, approved_at,
              shipped_at, received_at
         FROM transfer_orders WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<TransferOrderRow>();
}

/** Trae los items de un transfer_order. */
async function fetchTransferItems(db: D1Database, transferOrderId: string): Promise<TransferOrderItemRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, transfer_order_id, product_id, quantity, received_quantity, notes, created_at
         FROM transfer_order_items WHERE transfer_order_id = ?`,
    )
    .bind(transferOrderId)
    .all<TransferOrderItemRow>();
  return rows.results ?? [];
}

// ─── POST / (crear transfer order) ─────────────────────────────────────────
transfersRouter.post("/", validate({ body: createTransferSchema }), async (c) => {
  const db = c.env.DB;
  const body = c.get("validatedBody") as z.infer<typeof createTransferSchema>;

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as Role | undefined;
  if (!userRole || !hasPermission(userRole, "transfers", "create")) {
    return c.json(errBody("FORBIDDEN", "No tenés permisos para crear traslados"), 403);
  }

  // Para roles operativos, el source SIEMPRE es su default_branch — se ignora
  // cualquier source_branch_id que venga en el body (cierra el vector de que
  // un cashier/production/driver despache "en nombre de" otra sucursal).
  let sourceBranchId: string;
  if (OPERATIONAL_ROLES.has(userRole)) {
    if (!user.default_branch) {
      return c.json(errBody("FORBIDDEN", "Tu usuario no tiene una sucursal por defecto asignada"), 403);
    }
    sourceBranchId = user.default_branch;
  } else {
    // admin/owner/supervisor: pueden especificar origen explícitamente.
    if (!body.source_branch_id) {
      return c.json(errBody("VALIDATION_ERROR", "source_branch_id es requerido para tu rol"), 400);
    }
    sourceBranchId = body.source_branch_id;
  }

  if (sourceBranchId === body.destination_branch_id) {
    return c.json(errBody("VALIDATION_ERROR", "La sucursal origen y destino no pueden ser la misma"), 400);
  }

  // Validar que las sucursales existan y estén activas.
  const branchRows = await db
    .prepare(`SELECT id FROM branches WHERE id IN (?, ?) AND is_active = 1 AND deleted_at IS NULL`)
    .bind(sourceBranchId, body.destination_branch_id)
    .all<{ id: string }>();
  const foundBranchIds = new Set((branchRows.results ?? []).map((r) => r.id));
  if (!foundBranchIds.has(sourceBranchId) || !foundBranchIds.has(body.destination_branch_id)) {
    return c.json(errBody("VALIDATION_ERROR", "source_branch_id o destination_branch_id inválido"), 400);
  }

  // Validar que los productos existan.
  const productIds = [...new Set(body.items.map((i) => i.product_id))];
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

  const transferId = genId();
  const now = nowSqliteTs();

  const stmts = [
    db
      .prepare(
        `INSERT INTO transfer_orders
           (id, source_branch_id, destination_branch_id, requested_by, status, notes, requested_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(transferId, sourceBranchId, body.destination_branch_id, user.id, body.notes ?? null, now),
    ...body.items.map((item) =>
      db
        .prepare(
          `INSERT INTO transfer_order_items (id, transfer_order_id, product_id, quantity, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(genId(), transferId, item.product_id, item.quantity, now),
    ),
  ];

  await db.batch(stmts);

  return c.json(
    {
      success: true,
      data: {
        id: transferId,
        source_branch_id: sourceBranchId,
        destination_branch_id: body.destination_branch_id,
        status: "pending",
        requested_at: now,
      },
    },
    201,
  );
});

// ─── PATCH /:id/approve ─────────────────────────────────────────────────────
transfersRouter.patch("/:id/approve", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as Role | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo admin/supervisor/owner pueden aprobar traslados"), 403);
  }

  const existing = await fetchTransferOrder(db, id);
  if (!existing) return c.json(errBody("NOT_FOUND", "Traslado no encontrado"), 404);
  if (existing.status !== "pending") {
    return c.json(
      errBody("CONFLICT", `Solo se puede aprobar desde 'pending' (actual: ${existing.status})`),
      409,
    );
  }

  const now = nowSqliteTs();
  const updateStmt = db
    .prepare(
      `UPDATE transfer_orders SET status = 'approved', approved_by = ?, approved_at = ?
         WHERE id = ? AND status = 'pending'`,
    )
    .bind(user.id, now, id);

  // Puente hacia el sistema de Solicitudes (requests.ts): al aprobar un
  // traslado, se crea automáticamente una request type='delivery' para que
  // el reparto aparezca en la vista de deliveries existente, asignada al
  // rol repartidor de la sucursal ORIGEN (quien despacha).
  //
  // DESVIACIÓN vs el plan original: el plan decía "assigned_role='driver'
  // (usá el valor EN o ES que corresponda, chequealo)". requests.assigned_role
  // tiene un CHECK constraint (migraciones 0015/0016/0019) que SOLO acepta
  // ('admin','cajero','cocinero','repartidor','panadero','all') — son los
  // roles legacy en ESPAÑOL, un namespace totalmente distinto del Role EN
  // ('driver', etc.) que usa el JWT/users.role desde 0021/0022. Usar 'driver'
  // acá violaría el CHECK y el INSERT fallaría (revirtiendo todo el batch
  // atómico junto con la aprobación). Por eso usamos 'repartidor'.
  const deliveryRequestId = genId();
  const deliveryMetadata = JSON.stringify({
    transfer_order_id: id,
    destination_branch_id: existing.destination_branch_id,
  });
  const deliveryRequestStmt = db
    .prepare(
      `INSERT INTO requests (
         id, type, title, priority,
         created_by_user_id, created_by_role,
         assigned_role, branch_id,
         status, metadata, created_at, updated_at
       ) VALUES (?, 'delivery', ?, 'medium', ?, ?, 'repartidor', ?, 'approved', ?, ?, ?)`,
    )
    .bind(
      deliveryRequestId,
      `Reparto: traslado #${id}`,
      user.id,
      userRole,
      existing.source_branch_id,
      deliveryMetadata,
      now,
      now,
    );

  const [updateResult] = await db.batch([updateStmt, deliveryRequestStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "El traslado ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "approved", approved_at: now } });
});

// ─── PATCH /:id/reject ──────────────────────────────────────────────────────
transfersRouter.patch("/:id/reject", validate({ body: rejectSchema }), async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = c.get("validatedBody") as z.infer<typeof rejectSchema>;

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as Role | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo admin/supervisor/owner pueden rechazar traslados"), 403);
  }

  const existing = await fetchTransferOrder(db, id);
  if (!existing) return c.json(errBody("NOT_FOUND", "Traslado no encontrado"), 404);
  if (existing.status !== "pending") {
    return c.json(
      errBody("CONFLICT", `Solo se puede rechazar desde 'pending' (actual: ${existing.status})`),
      409,
    );
  }

  const now = nowSqliteTs();
  // notes se pisa con el motivo de rechazo si vino; si no, se preserva el
  // notes original del pedido (no queremos perder contexto del solicitante).
  const updateStmt = body.rejection_reason
    ? db
        .prepare(
          `UPDATE transfer_orders SET status = 'rejected', approved_by = ?, approved_at = ?, notes = ?
             WHERE id = ? AND status = 'pending'`,
        )
        .bind(user.id, now, body.rejection_reason, id)
    : db
        .prepare(
          `UPDATE transfer_orders SET status = 'rejected', approved_by = ?, approved_at = ?
             WHERE id = ? AND status = 'pending'`,
        )
        .bind(user.id, now, id);

  const [updateResult] = await db.batch([updateStmt]);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "El traslado ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "rejected", approved_at: now } });
});

// ─── PATCH /:id/ship ────────────────────────────────────────────────────────
transfersRouter.patch("/:id/ship", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as Role | undefined;
  if (!userRole) return c.json(errBody("FORBIDDEN", "Sin rol asignado"), 403);

  const existing = await fetchTransferOrder(db, id);
  if (!existing) return c.json(errBody("NOT_FOUND", "Traslado no encontrado"), 404);

  // Guard de ownership: admin/supervisor/owner siempre pueden. Roles operativos
  // solo si su default_branch coincide con el source del traslado.
  const isAdmin = ADMIN_ROLES.has(userRole);
  const isSourceOwner = OPERATIONAL_ROLES.has(userRole) && user.default_branch === existing.source_branch_id;
  if (!isAdmin && !isSourceOwner) {
    return c.json(errBody("FORBIDDEN", "Solo la sucursal origen o un admin puede despachar este traslado"), 403);
  }

  if (existing.status !== "approved") {
    return c.json(
      errBody("CONFLICT", `Solo se puede despachar desde 'approved' (actual: ${existing.status})`),
      409,
    );
  }

  const items = await fetchTransferItems(db, id);
  if (items.length === 0) {
    return c.json(errBody("CONFLICT", "El traslado no tiene items"), 409);
  }

  // Guard de stock: verificar que el origen tenga stock suficiente para CADA
  // item ANTES de mutar nada. Si algún item no alcanza, 409 y no se toca la DB.
  const productIds = items.map((i) => i.product_id);
  const placeholders = productIds.map(() => "?").join(",");
  const invRows = await db
    .prepare(
      `SELECT product_id, current_quantity FROM inventory
         WHERE branch_id = ? AND product_id IN (${placeholders})`,
    )
    .bind(existing.source_branch_id, ...productIds)
    .all<{ product_id: string; current_quantity: number }>();
  const stockByProduct = new Map((invRows.results ?? []).map((r) => [r.product_id, r.current_quantity]));

  const insufficient = items.find((item) => (stockByProduct.get(item.product_id) ?? 0) < item.quantity);
  if (insufficient) {
    return c.json(
      errBody(
        "INSUFFICIENT_STOCK",
        `Stock insuficiente en origen para el producto ${insufficient.product_id}`,
      ),
      409,
    );
  }

  const now = nowSqliteTs();

  const stmts = [
    db
      .prepare(
        `UPDATE transfer_orders SET status = 'in_transit', shipped_by = ?, shipped_at = ?
           WHERE id = ? AND status = 'approved'`,
      )
      .bind(user.id, now, id),
  ];

  for (const item of items) {
    stmts.push(
      // MAX(0, ...) como defensa adicional ante condiciones de carrera, mismo
      // patrón que inventory.ts POST /adjust — ya validamos stock suficiente
      // arriba, así que en el camino feliz esto nunca clampea.
      db
        .prepare(
          `UPDATE inventory SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
             WHERE product_id = ? AND branch_id = ?`,
        )
        .bind(item.quantity, now, item.product_id, existing.source_branch_id),
      db
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, branch_id, movement_type, quantity, reference_type, reference_id, user_id, notes, created_at)
           VALUES (?, ?, ?, 'transfer_out', ?, 'transfer_order', ?, ?, ?, ?)`,
        )
        .bind(genId(), item.product_id, existing.source_branch_id, item.quantity, id, user.id, existing.notes, now),
    );
  }

  const [updateResult] = await db.batch(stmts);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "El traslado ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "in_transit", shipped_at: now } });
});

// ─── PATCH /:id/receive ─────────────────────────────────────────────────────
transfersRouter.patch("/:id/receive", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as Role | undefined;
  if (!userRole) return c.json(errBody("FORBIDDEN", "Sin rol asignado"), 403);

  const existing = await fetchTransferOrder(db, id);
  if (!existing) return c.json(errBody("NOT_FOUND", "Traslado no encontrado"), 404);

  // Guard de ownership: admin/supervisor/owner siempre pueden. Roles operativos
  // (incluye driver) solo si su default_branch coincide con el destino.
  const isAdmin = ADMIN_ROLES.has(userRole);
  const isDestOwner = OPERATIONAL_ROLES.has(userRole) && user.default_branch === existing.destination_branch_id;
  if (!isAdmin && !isDestOwner) {
    return c.json(errBody("FORBIDDEN", "Solo la sucursal destino o un admin puede recibir este traslado"), 403);
  }

  if (existing.status !== "in_transit") {
    return c.json(
      errBody("CONFLICT", `Solo se puede recibir desde 'in_transit' (actual: ${existing.status})`),
      409,
    );
  }

  const items = await fetchTransferItems(db, id);
  const now = nowSqliteTs();

  // Estado final: usamos 'received' (uno de los valores contemplados por el
  // CHECK de transfer_orders.status). No diferenciamos 'completed' por
  // separado porque el plan no define un paso de conciliación adicional.
  const stmts = [
    db
      .prepare(
        `UPDATE transfer_orders SET status = 'received', received_by = ?, received_at = ?
           WHERE id = ? AND status = 'in_transit'`,
      )
      .bind(user.id, now, id),
  ];

  for (const item of items) {
    stmts.push(
      // Mismo patrón que inventory.ts POST /adjust: INSERT OR IGNORE para
      // crear la fila si el producto nunca tuvo stock en esta sucursal,
      // seguido de un UPDATE incondicional que suma la cantidad. Evitamos
      // ON CONFLICT/DO UPDATE porque no es un patrón usado en el resto del
      // repo y así nos mantenemos consistentes con el estilo existente.
      db
        .prepare(
          `INSERT OR IGNORE INTO inventory (id, product_id, branch_id, current_quantity, updated_at)
           VALUES (?, ?, ?, 0, ?)`,
        )
        .bind(genId(), item.product_id, existing.destination_branch_id, now),
      db
        .prepare(
          `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
             WHERE product_id = ? AND branch_id = ?`,
        )
        .bind(item.quantity, now, item.product_id, existing.destination_branch_id),
      db
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, branch_id, movement_type, quantity, reference_type, reference_id, user_id, notes, created_at)
           VALUES (?, ?, ?, 'transfer_in', ?, 'transfer_order', ?, ?, ?, ?)`,
        )
        .bind(genId(), item.product_id, existing.destination_branch_id, item.quantity, id, user.id, existing.notes, now),
      db
        .prepare(
          `UPDATE transfer_order_items SET received_quantity = ? WHERE id = ?`,
        )
        .bind(item.quantity, item.id),
    );
  }

  const [updateResult] = await db.batch(stmts);
  if ((updateResult?.meta?.changes ?? 0) === 0) {
    return c.json(errBody("CONFLICT", "El traslado ya cambió de estado"), 409);
  }

  return c.json({ success: true, data: { id, status: "received", received_at: now } });
});

// ─── GET /recommendations ───────────────────────────────────────────────────
// Compara productos con stock bajo (current_quantity <= min_stock) en la
// sucursal branch_id contra sucursales con superávit del mismo producto
// (current_quantity > min_stock + margin), sugiriendo un traslado.
//
// suggested_qty = min(déficit del destino, superávit disponible del origen)
// donde déficit = min_stock - current_quantity (clampeado a >= 1) y
// superávit = current_quantity - min_stock - margin (clampeado a >= 0).
//
// Solo accesible a roles que pueden ver la sucursal en cuestión de forma
// agregada (admin/owner/supervisor) — roles operativos no tienen visibilidad
// cross-branch necesaria para esta recomendación.
transfersRouter.get("/recommendations", validate({ query: recommendationsQuerySchema }), async (c) => {
  const db = c.env.DB;
  const query = c.get("validatedQuery") as z.infer<typeof recommendationsQuerySchema>;

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(db, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole") as Role | undefined;
  if (!userRole || !ADMIN_ROLES.has(userRole)) {
    return c.json(errBody("FORBIDDEN", "Solo admin/supervisor/owner pueden ver recomendaciones de traslado"), 403);
  }

  const margin = query.margin ?? 0;

  const rows = await db
    .prepare(
      `SELECT
         low.product_id      AS product_id,
         p.name               AS product_name,
         surplus.branch_id    AS from_branch_id,
         low.branch_id        AS to_branch_id,
         MIN(
           (low.min_stock - low.current_quantity),
           (surplus.current_quantity - surplus.min_stock - ?)
         ) AS suggested_qty
       FROM inventory low
       JOIN products p ON p.id = low.product_id AND p.deleted_at IS NULL
       JOIN inventory surplus
         ON surplus.product_id = low.product_id
        AND surplus.branch_id != low.branch_id
        AND surplus.current_quantity > (surplus.min_stock + ?)
       WHERE low.branch_id = ?
         AND low.current_quantity <= low.min_stock
       ORDER BY suggested_qty DESC`,
    )
    .bind(margin, margin, query.branch_id)
    .all<{
      product_id: string;
      product_name: string;
      from_branch_id: string;
      to_branch_id: string;
      suggested_qty: number;
    }>();

  const recommendations = (rows.results ?? []).filter((r) => r.suggested_qty > 0);

  return c.json({ success: true, data: recommendations });
});
