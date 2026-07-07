import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const batchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
// SECURITY: cap monetary and quantity inputs.
const MAX_QUANTITY = 1_000_000;
const MAX_UNIT_COST = 10_000_000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

const VALID_STATUSES = new Set(["active", "withdrawn", "sold_out", "expired"]);
const VALID_INVENTORY_METHODS = new Set(["FIFO", "LIFO"]);

interface BatchRow {
  id: string;
  product_id: string;
  branch_id: string;
  batch_number: string;
  entry_date: string;
  expiry_date: string | null;
  durability_days: number | null;
  cost_per_unit: number;
  initial_quantity: number;
  remaining_quantity: number;
  inventory_method: string;
  status: string;
  withdrawal_reason: string | null;
  supplier_id: string | null;
  purchase_order_id: string | null;
  production_batch_id: string | null;
  notes: string | null;
  created_at: string;
  product_name?: string;
  product_code?: string;
}

batchRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const productId = c.req.query("product_id");
  const status = c.req.query("status") ?? "active";
  const expiringWithinHoursRaw = c.req.query("expiring_within_hours");

  const whereParts: string[] = ["ib.branch_id = ?"];
  const bindings: (string | number)[] = [branchId];

  // status='all' devuelve el listado completo de la sucursal (para el full-fetch
  // que dispara el frontend cuando GET /version detecta un cambio de versión).
  if (status !== "all") {
    whereParts.push("ib.status = ?");
    bindings.push(status);
  }

  if (productId) {
    whereParts.push("ib.product_id = ?");
    bindings.push(productId);
  }

  if (expiringWithinHoursRaw) {
    const rawHoursNum = Number(expiringWithinHoursRaw);
    if (!Number.isFinite(rawHoursNum)) {
      return c.json(errBody("VALIDATION_ERROR", "expiring_within_hours debe ser un número no-negativo"), 400);
    }
    // Cap: mínimo 0, máximo 1 año (8760 h) para evitar fechas año 5000+ o NaN silencioso.
    const hours = Math.max(0, Math.min(rawHoursNum, 24 * 365));
    const limitTs = Date.now() + hours * 3_600_000;
    const limitDate = new Date(limitTs).toISOString().slice(0, 10);
    if (isNaN(limitTs) || limitDate === 'Invalid Date') {
      return c.json(errBody("VALIDATION_ERROR", "expiring_within_hours produce una fecha inválida"), 400);
    }
    whereParts.push("ib.expiry_date IS NOT NULL AND ib.expiry_date >= date('now') AND ib.expiry_date <= ?");
    bindings.push(limitDate);
  }

  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const countStmt = db
    .prepare(`SELECT COUNT(*) AS total FROM inventory_batches ib ${whereClause}`)
    .bind(...bindings);
  const listStmt = db
    .prepare(
      `SELECT ib.*, p.name AS product_name, p.code AS product_code
         FROM inventory_batches ib
         LEFT JOIN products p ON p.id = ib.product_id
         ${whereClause}
        ORDER BY (ib.expiry_date IS NULL), ib.expiry_date ASC, ib.entry_date ASC`,
    )
    .bind(...bindings);

  const [countResult, listResult] = await db.batch([countStmt, listStmt]);
  const total = (countResult?.results[0] as { total: number } | undefined)?.total ?? 0;
  const rows = (listResult?.results ?? []) as BatchRow[];

  return c.json({ success: true, data: rows, total });
});

// ─── GET /version ──────────────────────────────────────────────────────────
// El frontend compara version local vs remota para decidir refetch de lotes.
batchRoutes.get("/version", async (c) => {
  const db = c.env.DB;
  const row = await db
    .prepare("SELECT version, updated_at FROM data_versions WHERE key = 'batches' LIMIT 1")
    .first<{ version: number; updated_at: string }>();

  if (!row) {
    // Si no existe la row, devolvemos version=0 — el frontend tratará todo como nuevo.
    return c.json({ success: true, data: { version: 0, updated_at: null } });
  }
  return c.json({ success: true, data: { version: row.version, updated_at: row.updated_at } });
});

batchRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare(
      `SELECT ib.*, p.name AS product_name, p.code AS product_code
       FROM inventory_batches ib
       LEFT JOIN products p ON p.id = ib.product_id
       WHERE ib.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<BatchRow>();

  if (!row) return c.json(errBody("NOT_FOUND", "Lote no encontrado"), 404);
  return c.json({ success: true, data: row });
});

batchRoutes.post("/", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: only privileged roles can mint inventory_batches. A cashier
  // creating a batch is equivalent to manufacturing inventory out of nothing.
  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse" &&
    userRole !== "production"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear lotes"), 403);
  }

  const db = c.env.DB;
  const body = await c.req.json<{
    product_id: string;
    branch_id?: string;
    batch_number: string;
    entry_date: string;
    expiry_date?: string;
    durability_days?: number;
    cost_per_unit: number;
    initial_quantity: number;
    remaining_quantity?: number;
    inventory_method?: string;
    supplier_id?: string;
    notes?: string;
    idempotency_key?: string;
  }>();

  if (!body.product_id) return c.json(errBody("VALIDATION_ERROR", "product_id es requerido"), 400);
  if (!body.batch_number) return c.json(errBody("VALIDATION_ERROR", "batch_number es requerido"), 400);
  if (!body.entry_date) return c.json(errBody("VALIDATION_ERROR", "entry_date es requerido"), 400);
  if (!isValidDate(body.entry_date)) {
    return c.json(errBody("VALIDATION_ERROR", "entry_date debe ser una fecha válida YYYY-MM-DD"), 400);
  }
  if (body.expiry_date !== undefined && !isValidDate(body.expiry_date)) {
    return c.json(errBody("VALIDATION_ERROR", "expiry_date debe ser una fecha válida YYYY-MM-DD"), 400);
  }
  if (
    typeof body.cost_per_unit !== "number" ||
    !Number.isFinite(body.cost_per_unit) ||
    body.cost_per_unit < 0 ||
    body.cost_per_unit > MAX_UNIT_COST
  ) {
    return c.json(errBody("VALIDATION_ERROR", "cost_per_unit debe ser un número finito >= 0"), 400);
  }
  if (
    typeof body.initial_quantity !== "number" ||
    !Number.isFinite(body.initial_quantity) ||
    body.initial_quantity <= 0 ||
    body.initial_quantity > MAX_QUANTITY
  ) {
    return c.json(errBody("VALIDATION_ERROR", "initial_quantity debe ser un número finito > 0"), 400);
  }
  if (
    body.remaining_quantity !== undefined &&
    (typeof body.remaining_quantity !== "number" ||
      !Number.isFinite(body.remaining_quantity) ||
      body.remaining_quantity < 0 ||
      body.remaining_quantity > body.initial_quantity)
  ) {
    return c.json(
      errBody("VALIDATION_ERROR", "remaining_quantity debe ser un número finito entre 0 e initial_quantity"),
      400,
    );
  }

  const inventoryMethod = body.inventory_method ?? "FIFO";
  if (!VALID_INVENTORY_METHODS.has(inventoryMethod)) {
    return c.json(errBody("VALIDATION_ERROR", "inventory_method debe ser FIFO o LIFO"), 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const remaining = body.remaining_quantity ?? body.initial_quantity;

  // IDEMPOTENCY: si el cliente reintenta tras un timeout offline, el mismo
  // idempotency_key evita crear un segundo lote con remaining_quantity duplicada.
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim() !== ""
      ? body.idempotency_key.trim()
      : null;

  if (idempotencyKey) {
    const existing = await db
      .prepare("SELECT * FROM inventory_batches WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first<BatchRow>();
    if (existing) {
      return c.json({ success: true, idempotent_replay: true, data: existing });
    }
  }

  const id = genId();

  await db
    .prepare(
      `INSERT INTO inventory_batches
        (id, product_id, branch_id, batch_number, entry_date, expiry_date, durability_days,
         cost_per_unit, initial_quantity, remaining_quantity, inventory_method, status,
         supplier_id, notes, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id,
      body.product_id,
      branchId,
      body.batch_number,
      body.entry_date,
      body.expiry_date ?? null,
      body.durability_days ?? null,
      body.cost_per_unit,
      body.initial_quantity,
      remaining,
      inventoryMethod,
      body.supplier_id ?? null,
      body.notes ?? null,
      idempotencyKey,
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

batchRoutes.put("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse" &&
    userRole !== "production"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar lotes"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");

  const existing = await db
    .prepare("SELECT id FROM inventory_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Lote no encontrado"), 404);

  const body = await c.req.json<{
    remaining_quantity?: number;
    status?: string;
    withdrawal_reason?: string;
    notes?: string;
    expiry_date?: string;
  }>();

  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.remaining_quantity !== undefined) {
    if (
      typeof body.remaining_quantity !== "number" ||
      !Number.isFinite(body.remaining_quantity) ||
      body.remaining_quantity < 0 ||
      body.remaining_quantity > MAX_QUANTITY
    ) {
      return c.json(errBody("VALIDATION_ERROR", "remaining_quantity debe ser un número finito no-negativo"), 400);
    }
    setClauses.push("remaining_quantity = ?");
    values.push(body.remaining_quantity);
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return c.json(errBody("VALIDATION_ERROR", `status debe ser uno de: ${[...VALID_STATUSES].join(", ")}`), 400);
    }
    setClauses.push("status = ?");
    values.push(body.status);
  }

  if (body.withdrawal_reason !== undefined) {
    setClauses.push("withdrawal_reason = ?");
    values.push(body.withdrawal_reason);
  }

  if (body.notes !== undefined) {
    setClauses.push("notes = ?");
    values.push(body.notes);
  }

  if (body.expiry_date !== undefined) {
    if (!isValidDate(body.expiry_date)) {
      return c.json(errBody("VALIDATION_ERROR", "expiry_date debe ser una fecha válida YYYY-MM-DD"), 400);
    }
    setClauses.push("expiry_date = ?");
    values.push(body.expiry_date);
  }

  if (setClauses.length === 0) {
    return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);
  }

  // FIX: incluir updated_at en el SET para que el sync diferencial detecte
  // cambios y propague el lote modificado a los clientes offline.
  const updatedAt = nowSqliteTs();
  setClauses.push("updated_at = ?");
  values.push(updatedAt);

  values.push(id);

  // FIX R8-3 — emitir stock_movements cuando status cambia a 'withdrawn' o
  // 'expired' y el lote aún tiene remaining_quantity > 0.
  // Sin esto, el inventario queda inflado con stock que ya no está disponible.
  // Replicamos el mismo patrón de /expire-stale (líneas ~386-409).
  const newStatus = body.status;
  const needsMovement = newStatus === "withdrawn" || newStatus === "expired";

  if (needsMovement) {
    // Leer remaining_quantity y datos del lote actual para el movement.
    const currentBatch = await db
      .prepare("SELECT product_id, branch_id, remaining_quantity FROM inventory_batches WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ product_id: string; branch_id: string; remaining_quantity: number }>();

    if (currentBatch && currentBatch.remaining_quantity > 0) {
      const movementType = newStatus === "withdrawn" ? "batch_withdrawn" : "batch_expired";
      const movId = genId();

      const stmts = [
        db.prepare(`UPDATE inventory_batches SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
        db.prepare(
          `INSERT INTO stock_movements (id, product_id, branch_id, batch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          movId,
          currentBatch.product_id,
          currentBatch.branch_id,
          id,
          movementType,
          currentBatch.remaining_quantity,
          newStatus === "withdrawn" ? "Lote retirado manualmente" : "Lote marcado como expirado",
          user.id,
          updatedAt,
        ),
        db.prepare(
          `UPDATE inventory
             SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
           WHERE product_id = ? AND branch_id = ?`,
        ).bind(currentBatch.remaining_quantity, updatedAt, currentBatch.product_id, currentBatch.branch_id),
      ];

      await db.batch(stmts);
      return c.json({ success: true, data: { id } });
    }
  }

  await db
    .prepare(`UPDATE inventory_batches SET ${setClauses.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { id } });
});

// POST /expire-stale
// FIX A3: marca como 'expired' todos los lotes activos cuya expiry_date ya pasó
// según hora argentina (UTC-3). Pensado para ser disparado por el cron schedule
// del Worker o manualmente por un admin. Devuelve la cantidad de lotes
// actualizados para que el frontend pueda mostrar un toast.
//
// FIX: procesa en lotes de 100 para evitar timeouts con miles de lotes.
// FIX: emite stock_movements de tipo 'expired_out' para descontar el inventario
// de los lotes expirados — sin esto siguen contando como stock vendible.
batchRoutes.post("/expire-stale", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para expirar lotes"), 403);
  }

  const db = c.env.DB;
  const now = nowSqliteTs();

  // Obtener los lotes a expirar ANTES del UPDATE para tener sus
  // remaining_quantities y poder emitir los stock_movements correctos.
  const staleRows = await db
    .prepare(
      `SELECT id, product_id, branch_id, remaining_quantity
         FROM inventory_batches
        WHERE status = 'active'
          AND expiry_date IS NOT NULL
          AND expiry_date < DATE('now', '-3 hours')
        LIMIT 100`,
    )
    .all<{ id: string; product_id: string; branch_id: string; remaining_quantity: number }>();

  const batches = staleRows.results ?? [];
  if (batches.length === 0) {
    return c.json({ success: true, data: { expired_count: 0 } });
  }

  const ids = batches.map((b) => b.id);
  const placeholders = ids.map(() => "?").join(",");

  // Construir todos los statements del batch D1:
  // 1. UPDATE masivo limitado a los 100 IDs seleccionados.
  // 2. Por cada lote: INSERT stock_movement 'expired_out' + UPDATE inventory.
  const stmts = [
    db
      .prepare(`UPDATE inventory_batches SET status = 'expired' WHERE id IN (${placeholders})`)
      .bind(...ids),
  ];

  for (const b of batches) {
    if (b.remaining_quantity <= 0) continue;

    const movId = genId();
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, branch_id, batch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, ?, ?, 'expired_out', ?, 'Lote expirado — baja automática', ?, ?)`,
        )
        .bind(movId, b.product_id, b.branch_id, b.id, b.remaining_quantity, user.id, now),
    );

    stmts.push(
      db
        .prepare(
          `UPDATE inventory
              SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
            WHERE product_id = ? AND branch_id = ?`,
        )
        .bind(b.remaining_quantity, now, b.product_id, b.branch_id),
    );
  }

  await db.batch(stmts);

  return c.json({ success: true, data: { expired_count: batches.length } });
});

batchRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (
    userRole !== "admin" &&
    userRole !== "owner" &&
    userRole !== "supervisor" &&
    userRole !== "warehouse"
  ) {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para retirar lotes"), 403);
  }

  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ withdrawal_reason?: string }>().catch((): { withdrawal_reason?: string } => ({}));

  const existing = await db
    .prepare("SELECT id, product_id, branch_id, remaining_quantity FROM inventory_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; product_id: string; branch_id: string; remaining_quantity: number }>();
  if (!existing) return c.json(errBody("NOT_FOUND", "Lote no encontrado"), 404);

  const now = nowSqliteTs();

  // FIX R8-3 — emitir stock_movement 'batch_withdrawn' cuando el soft-delete
  // se ejecuta con remaining_quantity > 0. Sin esto el inventario queda inflado.
  if (existing.remaining_quantity > 0) {
    const movId = genId();
    await db.batch([
      db.prepare(
        `UPDATE inventory_batches SET status = 'withdrawn', withdrawal_reason = ? WHERE id = ?`,
      ).bind(body.withdrawal_reason ?? null, id),
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, batch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, ?, 'batch_withdrawn', ?, 'Lote dado de baja', ?, ?)`,
      ).bind(movId, existing.product_id, existing.branch_id, id, existing.remaining_quantity, user.id, now),
      db.prepare(
        `UPDATE inventory
           SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
         WHERE product_id = ? AND branch_id = ?`,
      ).bind(existing.remaining_quantity, now, existing.product_id, existing.branch_id),
    ]);
  } else {
    await db
      .prepare(
        `UPDATE inventory_batches SET status = 'withdrawn', withdrawal_reason = ? WHERE id = ?`,
      )
      .bind(body.withdrawal_reason ?? null, id)
      .run();
  }

  return c.json({ success: true, data: { id } });
});
