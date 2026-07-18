import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const salesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

export const MAX_SALE_NUMBER_RETRIES = 15;

// Subconjunto de DOCUMENT_TYPES que puede emitirse como parte de una venta
// (sales.document_type CHECK, migración 0023). nota_credito/remito/presupuesto
// viven en tablas propias y tienen sus propias rutas (credit-notes.ts,
// remitos.ts, budgets.ts) — no pasan por acá.
const DOCUMENT_TYPES_SALES = ["ticket", "factura_a", "factura_b", "factura_c"] as const;
type SalesDocumentType = (typeof DOCUMENT_TYPES_SALES)[number];

function isSalesDocumentType(value: unknown): value is SalesDocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES_SALES as readonly string[]).includes(value);
}

/**
 * Tolerancia máxima en ARS entre subtotal_bruto − discount_total − total_final.
 * Bajada de 1 ARS a 0.05 ARS para detectar errores de redondeo reales del cliente
 * sin silenciarlos. Diferencias entre 0 y 0.05 se loguean como AUDIT warnings.
 */
export const TOTAL_TOLERANCE_ARS = 0.05;

// GET /
salesRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const sortOrder = c.req.query("sort_order") === "asc" ? "ASC" : "DESC";

  let query = "SELECT * FROM sales WHERE branch_id = ?";
  let countQuery = "SELECT COUNT(*) as total FROM sales WHERE branch_id = ?";
  const bindings: (string | number)[] = [branchId];
  const countBindings: (string | number)[] = [branchId];

  // El cliente envía fechas en hora Argentina (UTC-3). created_at se guarda en
  // UTC, así que convertimos:
  //   from_date "YYYY-MM-DD" (ARG midnight)      → "YYYY-MM-DDT03:00:00.000Z" (UTC)
  //   to_date   "YYYY-MM-DD" (ARG 23:59:59)      → "YYYY-MM-(DD+1)T02:59:59.999Z"
  // Si el cliente ya manda timestamp con hora, lo respetamos tal cual.
  // SECURITY: rechazamos valores ambiguos (ej. "2026-06-19 15:00" con espacio
  // en vez de T) que pasarían el guard de bareDate pero silenciosamente harían
  // que la comparación contra created_at (ISO 8601) devuelva resultados erróneos.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
  const isValidDateInput = (s: string): boolean => ISO_DATE_RE.test(s);
  const isBareDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const argDateToUtcFrom = (d: string): string => `${d}T03:00:00.000Z`;
  const argDateToUtcTo = (d: string): string => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return `${dt.toISOString().slice(0, 10)}T02:59:59.999Z`;
  };

  if (fromDate) {
    if (!isValidDateInput(fromDate)) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "from_date debe ser ISO 8601 o YYYY-MM-DD" } }, 400);
    }
    const fromUtc = isBareDate(fromDate) ? argDateToUtcFrom(fromDate) : fromDate;
    query += " AND created_at >= ?";
    countQuery += " AND created_at >= ?";
    bindings.push(fromUtc);
    countBindings.push(fromUtc);
  }

  if (toDate) {
    if (!isValidDateInput(toDate)) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "to_date debe ser ISO 8601 o YYYY-MM-DD" } }, 400);
    }
    const toUtc = isBareDate(toDate) ? argDateToUtcTo(toDate) : toDate;
    query += " AND created_at <= ?";
    countQuery += " AND created_at <= ?";
    bindings.push(toUtc);
    countBindings.push(toUtc);
  }

  query += ` ORDER BY created_at ${sortOrder} LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const [results, countResult] = await Promise.all([
    db.prepare(query).bind(...bindings).all(),
    db.prepare(countQuery).bind(...countBindings).first<{ total: number }>(),
  ]);

  return c.json({
    success: true,
    data: results.results ?? [],
    pagination: {
      total: countResult?.total ?? 0,
      limit,
      offset,
    },
  });
});

// GET /:id
salesRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const sale = await db
    .prepare("SELECT * FROM sales WHERE id = ? LIMIT 1")
    .bind(id)
    .first();

  if (!sale) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Venta no encontrada" } }, 404);
  }

  // SECURITY: evitar que un cajero de sucursal A acceda a ventas de sucursal B
  // pasando el ID directamente. Admin/owner pueden ver ventas de cualquier sucursal.
  const userRole = c.get("userRole");
  const tokenBranchId = c.get("branchId");
  if ((sale as { branch_id?: string }).branch_id && (sale as { branch_id?: string }).branch_id !== tokenBranchId && userRole !== "admin" && userRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "La venta pertenece a otra sucursal" } }, 403);
  }

  const [itemsResult, paymentsResult] = await Promise.all([
    db
      .prepare("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC")
      .bind(id)
      .all(),
    db
      .prepare("SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at ASC")
      .bind(id)
      .all(),
  ]);

  return c.json({
    success: true,
    data: {
      ...sale,
      items: itemsResult.results ?? [],
      payments: paymentsResult.results ?? [],
    },
  });
});

// POST /
salesRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    id?: string;
    client_id?: string;
    idempotency_key?: string;
    // SECURITY: aceptado por compat con clientes viejos, pero IGNORADO — la
    // sucursal real siempre sale de c.get("branchId") (resuelto por el
    // middleware resolveBranchScope), nunca de este campo. Ver comentario
    // en la asignación de `branchId` más abajo.
    branch_id?: string;
    customer_id?: string;
    items: {
      product_id: string;
      quantity: number;
      unit_price: number;
      discount?: number;
      tax_rate?: number;
      tax_amount?: number;
      notes?: string;
    }[];
    payments: {
      payment_method: string;
      amount: number;
      reference?: string;
    }[];
    notes?: string;
    // Nuevos campos canónicos (3 campos explícitos, source of truth = frontend)
    subtotal_bruto?: number;
    discount_total?: number;
    total_final?: number;
    // Legacy (compat con sync queue antiguo)
    subtotal?: number;
    tax_total?: number;
    total?: number;
    // Document Types (Comprobantes) — default 'ticket' por compatibilidad con
    // clientes viejos que todavía no mandan este campo.
    document_type?: string;
  }>();

  // SECURITY: el branch_id NUNCA se deriva del body — un cliente podría mandar
  // el branch_id de una sucursal ajena y la venta (+ descuento de inventory +
  // stock_movements) quedaría grabada ahí. c.get("branchId") ya fue resuelto
  // y validado por el middleware resolveBranchScope (auth.ts), enganchado
  // global en app.ts: para roles operativos fuerza token.default_branch
  // (ignora cualquier otro valor); para roles elevados permite override
  // validado por membership. Mismo patrón que credit-notes/remitos/budgets.
  const branchId = c.get("branchId") || DEFAULT_BRANCH_ID;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  const now = nowSqliteTs();

  // ── Document Types (Comprobantes) ──────────────────────────────────────
  // DT-6: solo 4 de los 7 tipos globales se emiten como venta. Default
  // 'ticket' si no viene, por compatibilidad con clientes viejos.
  if (body.document_type !== undefined && !isSalesDocumentType(body.document_type)) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `document_type inválido. Valores permitidos: ${DOCUMENT_TYPES_SALES.join(", ")}`,
        },
      },
      400,
    );
  }
  const documentType: SalesDocumentType = body.document_type === undefined ? "ticket" : body.document_type;

  // ── Idempotencia ────────────────────────────────────────────────────────
  // Si llega un idempotency_key y ya existe una venta con ese key, devolver la
  // venta existente con 200 sin re-procesar nada. Esto blinda los reintentos
  // del POS (red caída, cliente reenviando, cola de sync, etc).
  const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.trim() !== ""
    ? body.idempotency_key.trim()
    : null;

  if (idempotencyKey) {
    const existing = await db
      .prepare("SELECT id, sale_number, branch_id, created_at, document_type FROM sales WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first<{ id: string; sale_number: number; branch_id: string; created_at: string; document_type: string }>();
    if (existing) {
      return c.json({
        success: true,
        data: {
          id: existing.id,
          sale_number: existing.sale_number,
          branch_id: existing.branch_id,
          created_at: existing.created_at,
          document_type: existing.document_type,
          idempotent_replay: true,
        },
      }, 200);
    }
  }

  // sale_number se calcula dentro del bucle de retry (más abajo) porque bajo
  // concurrencia dos requests pueden leer el mismo MAX+1 y violar el UNIQUE
  // (branch_id, sale_number) — migración 0008. Mantenemos `let` para que el
  // bloque de INSERT lo pueda re-asignar tras un conflicto.
  let saleNumber = 0;

  const items = body.items ?? [];
  if (items.length === 0) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Una venta debe tener al menos un item" } }, 400);
  }
  if (items.length > 500) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Una venta no puede tener más de 500 items" } }, 400);
  }
  // SECURITY: cap quantities and prices so a buggy or malicious client
  // cannot persist Infinity-adjacent values into sales/inventory.
  const MAX_ITEM_QUANTITY = 100_000;
  const MAX_UNIT_PRICE = 10_000_000;
  for (const item of items) {
    if (!item.product_id || typeof item.product_id !== 'string') return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'item.product_id es requerido' } }, 400);
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_ITEM_QUANTITY) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'item.quantity debe ser un número finito > 0' } }, 400);
    const price = Number(item.unit_price);
    if (!Number.isFinite(price) || price < 0 || price > MAX_UNIT_PRICE) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'item.unit_price debe ser un número finito >= 0' } }, 400);
    if (item.discount !== undefined && (!Number.isFinite(Number(item.discount)) || Number(item.discount) < 0 || Number(item.discount) > MAX_UNIT_PRICE)) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'item.discount debe ser un número finito >= 0' } }, 400);
    }
    if (item.tax_amount !== undefined && (!Number.isFinite(Number(item.tax_amount)) || Number(item.tax_amount) < 0 || Number(item.tax_amount) > MAX_UNIT_PRICE)) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'item.tax_amount debe ser un número finito >= 0' } }, 400);
    }
  }
  const payments = body.payments ?? [];
  if (payments.length > 50) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Una venta no puede tener más de 50 medios de pago' } }, 400);
  }
  for (const p of payments) {
    if (!p.payment_method || typeof p.payment_method !== 'string') {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'payment.payment_method es requerido' } }, 400);
    }
    if (!Number.isFinite(Number(p.amount)) || Number(p.amount) < 0 || Number(p.amount) > MAX_UNIT_PRICE) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'payment.amount debe ser un número finito >= 0' } }, 400);
    }
  }

  // ── Document Types (Comprobantes): habilitación + CUIT (DT-7, DT-11) ────
  // Validamos ANTES de calcular totales/numeración para no gastar cómputo ni
  // numeración en un intento que de todos modos va a ser rechazado.
  const settingRow = await db
    .prepare(`SELECT enabled FROM document_type_settings WHERE branch_id = ? AND document_type = ?`)
    .bind(branchId, documentType)
    .first<{ enabled: number }>();
  if (!settingRow || settingRow.enabled !== 1) {
    return c.json(
      {
        success: false,
        error: { code: "DOCUMENT_TYPE_DISABLED", message: `El tipo de comprobante '${documentType}' no está habilitado en esta sucursal` },
      },
      409,
    );
  }

  // DT-7: Factura A/B/C requiere customer con document_type='cuit' y
  // document_number no vacío. Se valida server-side, no solo en la UI.
  if (documentType === "factura_a" || documentType === "factura_b" || documentType === "factura_c") {
    if (!body.customer_id) {
      return c.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Factura A/B/C requiere un cliente con CUIT" } },
        400,
      );
    }
    const customer = await db
      .prepare(`SELECT document_type, document_number FROM customers WHERE id = ? LIMIT 1`)
      .bind(body.customer_id)
      .first<{ document_type: string | null; document_number: string | null }>();
    if (!customer || customer.document_type !== "cuit" || !customer.document_number?.trim()) {
      return c.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Factura A/B/C requiere un cliente con document_type='cuit' y document_number cargado" },
        },
        400,
      );
    }
  }

  // SOURCE OF TRUTH: el frontend manda los 3 campos canónicos (subtotal_bruto,
  // discount_total, total_final). El backend NO recalcula — solo valida que la
  // identidad |subtotal_bruto - discount_total - total_final| <= 1 se cumpla.
  // Si no llegan, caemos al cálculo legacy desde los items (sync queue antiguo).
  const subtotalBrutoFromItems = parseFloat(
    items.reduce((acc, item) => acc + Number(item.unit_price) * Number(item.quantity), 0).toFixed(2),
  );

  let subtotal: number;
  let discountTotal: number;
  let total: number;

  const hasCanonicalTotals =
    Number.isFinite(Number(body.subtotal_bruto)) &&
    Number.isFinite(Number(body.discount_total)) &&
    Number.isFinite(Number(body.total_final));

  if (hasCanonicalTotals) {
    subtotal = parseFloat(Number(body.subtotal_bruto).toFixed(2));
    discountTotal = parseFloat(Number(body.discount_total).toFixed(2));
    total = parseFloat(Number(body.total_final).toFixed(2));
    // Identidad contable: tolerancia ±TOTAL_TOLERANCE_ARS por redondeos de cliente.
    const totalDiff = Math.abs(subtotal - discountTotal - total);
    if (totalDiff > TOTAL_TOLERANCE_ARS) {
      return c.json(
        {
          success: false,
          error: { code: "TOTALS_MISMATCH", message: "Los totales de la venta no cuadran" },
        },
        400,
      );
    }
    if (totalDiff > 0) {
      console.warn(`[AUDIT] sale total diff: ${totalDiff} ARS`);
    }
  } else {
    // Legacy / cola de sync: derivamos de los items.
    const computedDiscountTotal = parseFloat(
      items.reduce((acc, item) => acc + Number(item.discount ?? 0), 0).toFixed(2),
    );
    const computedTaxTotal = parseFloat(
      items.reduce((acc, item) => acc + Number(item.tax_amount ?? 0), 0).toFixed(2),
    );
    subtotal = subtotalBrutoFromItems;
    discountTotal = computedDiscountTotal;
    total = parseFloat((subtotal - discountTotal + computedTaxTotal).toFixed(2));
  }

  // tax_total: si llegó explícito desde el cliente lo respetamos; si no, derivamos.
  const taxTotal = Number.isFinite(Number(body.tax_total))
    ? parseFloat(Number(body.tax_total).toFixed(2))
    : parseFloat(
        items.reduce((acc, item) => acc + Number(item.tax_amount ?? 0), 0).toFixed(2),
      );

  if (!Number.isFinite(total) || total < 0) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Total calculado inválido" } }, 400);
  }

  // Aceptamos el ID generado por el cliente para que void/refund posteriores
  // hagan match contra el mismo registro local. Validamos formato: UUID con
  // o sin guiones (32 o 36 chars hex). Si no llega o es inválido, generamos.
  const clientProvidedId = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  const isValidLocalId =
    /^[0-9a-f]{32}$/.test(clientProvidedId) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clientProvidedId);
  const saleId = isValidLocalId
    ? clientProvidedId.replace(/-/g, "")
    : genId();

  const itemStatements = items.flatMap(item => {
    const itemId = genId();
    const movementId = genId();
    const qty = Number(item.quantity);
    const price = Number(item.unit_price);
    const disc = Number(item.discount ?? 0);
    const itemTotal = price * qty - disc;

    return [
      db.prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, tax_rate, tax_amount, total, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        itemId, saleId, item.product_id, qty,
        price, disc,
        item.tax_rate ?? 0, item.tax_amount ?? 0,
        itemTotal, item.notes ?? null, now
      ),
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'sale_out', ?, 'Venta automática', ?, ?)`
      ).bind(movementId, item.product_id, branchId, qty, userId, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
         WHERE product_id = ? AND branch_id = ?`
      ).bind(qty, now, item.product_id, branchId),
    ];
  });

  const paymentStatements = payments.map(payment => {
    const paymentId = genId();
    return db.prepare(
      `INSERT INTO sale_payments (id, sale_id, payment_method, amount, reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(paymentId, saleId, payment.payment_method, payment.amount, payment.reference ?? null, now);
  });

  // SECURITY: D1 batch limit ~100. With 3 statements per item plus payments,
  // a single sale could exceed the limit; clip to a safe upper bound.
  // (saleInsert se agrega adentro del loop para que use el sale_number actual)
  const baseStatementsCount = 1 + itemStatements.length + paymentStatements.length;
  if (baseStatementsCount > 100) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "La venta excede el máximo de operaciones por batch. Reduce items o pagos." } },
      400,
    );
  }

  // ── Document Types (Comprobantes): número de comprobante (DT-1..DT-3) ───
  // DESVIACIÓN DOCUMENTADA vs plan original: `sales.sale_number` (con su
  // UNIQUE(branch_id, sale_number) de la migración 0008) es un contador
  // legacy GLOBAL de la tabla `sales`, compartido por todos los document_type
  // (no distingue tipo). Reemplazarlo por nextSequence(branchId, documentType)
  // haría que dos ventas de TIPOS DISTINTOS (ej. un ticket #1 y una
  // factura_a #1) pidan el mismo número y violen ese UNIQUE — la migración
  // 0023 (Fase 1, ya cerrada) no tocó ese constraint ni agregó una columna
  // separada para esto, y no corresponde a esta fase crear una migración
  // correctiva de schema. Por eso:
  //   - `sale_number` sigue siendo el contador interno global de `sales`
  //     (retry-loop MAX+1 sin cambios, líneas de abajo).
  //   - `document_number` es un campo NUEVO, derivado de
  //     `document_sequences(branch_id, document_type)` — este es el número
  //     correlativo por tipo que exige DT-1/DT-2/DT-5, el que se
  //     imprime/muestra como identificador real del comprobante.
  //
  // FISCAL: el incremento de document_sequences NO se ejecuta como sentencia
  // suelta antes del db.batch() de la venta (lo que hacía nextSequence() acá
  // originalmente) — si el batch de la venta fallaba después (FK, UNIQUE de
  // sale_number agotando reintentos, etc.) ese número quedaba consumido para
  // siempre sin comprobante real asociado: un hueco permanente en la
  // numeración, inaceptable para Factura A/B/C (AFIP exige correlatividad sin
  // huecos). Ahora el UPDATE...RETURNING de document_sequences es la PRIMERA
  // sentencia del mismo db.batch() que el INSERT de la venta — D1 ejecuta
  // batch() como una única transacción atómica (todo o nada) y de forma
  // secuencial, así que si el resto del batch falla, el incremento de
  // document_sequences se revierte junto con todo lo demás.
  // Solo se incrementa UNA vez por request (fuera del retry-loop de abajo):
  // los reintentos son por colisión de `sale_number` (contador legacy
  // distinto), no por document_number, así que no correspondería re-incrementar
  // la secuencia en cada intento — se arma la sentencia una sola vez y se
  // reutiliza en cada iteración del batch.
  const sequenceUpdate = db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, documentType);

  // Retry loop para colisiones del índice UNIQUE (branch_id, sale_number).
  // Bajo concurrencia dos requests pueden leer el mismo MAX+1; el segundo
  // INSERT falla por el UNIQUE de migración 0008. Reintentamos hasta
  // MAX_SALE_NUMBER_RETRIES veces recalculando MAX+1, con backoff lineal
  // de 10ms por intento para reducir la probabilidad de colisión bajo carga.
  //
  // IMPORTANTE: como sequenceUpdate ahora vive DENTRO del db.batch() de la
  // venta, un reintento por colisión de sale_number re-ejecutaría también el
  // incremento de document_sequences (el batch entero se revirtió al fallar,
  // así que no hay doble incremento real — cada intento fallido revierte su
  // propio UPDATE junto con el resto). Solo el intento que efectivamente
  // commitea dispara UN incremento neto.
  let attempts = 0;
  let inserted = false;
  let documentNumber = 0;

  while (attempts < MAX_SALE_NUMBER_RETRIES && !inserted) {
    if (attempts > 0) {
      await new Promise(r => setTimeout(r, attempts * 10));
    }
    const saleNumberRow = await db
      .prepare(
        "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next_number FROM sales WHERE branch_id = ?"
      )
      .bind(branchId)
      .first<{ next_number: number }>();
    saleNumber = saleNumberRow?.next_number ?? 1;

    const saleInsert = db
      .prepare(
        `INSERT INTO sales (id, client_id, idempotency_key, branch_id, user_id, customer_id, sale_number, subtotal, discount_total, tax_total, total, status, sync_status, notes, created_at, document_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'pending', ?, ?, ?)`
      )
      .bind(
        saleId,
        body.client_id ?? null,
        idempotencyKey,
        branchId,
        userId,
        body.customer_id ?? null,
        saleNumber,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        body.notes ?? null,
        now,
        documentType
      );

    // Auto-seed: si document_sequences no tiene fila para esta combinación,
    // la sembramos CON ANTELACIÓN al batch para no quemar numeración ni
    // insertar la venta sin su secuencia correspondiente.
    const existingSeq = await db
      .prepare("SELECT 1 FROM document_sequences WHERE branch_id = ? AND document_type = ? LIMIT 1")
      .bind(branchId, documentType)
      .first<{ 1: number }>();
    if (!existingSeq) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO document_sequences (branch_id, document_type, last_number, created_at, updated_at)
           VALUES (?, ?, 0, ?, ?)`,
        )
        .bind(branchId, documentType, now, now)
        .run();
    }

    try {
      const batchResults = await db.batch([sequenceUpdate, saleInsert, ...itemStatements, ...paymentStatements]);
      const sequenceResult = batchResults[0] as D1Result<{ last_number: number }>;
      const sequenceRow = sequenceResult.results?.[0];

      if (!sequenceRow) {
        throw new Error(
          `document_sequences no tiene seed para branch_id=${branchId} document_type=${documentType} — revisar migración 0023`,
        );
      }
      documentNumber = sequenceRow.last_number;
      inserted = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // 1) Race con idempotency_key: devolver la venta original (replay).
      if (idempotencyKey && /UNIQUE|idempotency_key|idempotency/i.test(message)) {
        const existing = await db
          .prepare("SELECT id, sale_number, branch_id, created_at, status FROM sales WHERE idempotency_key = ? LIMIT 1")
          .bind(idempotencyKey)
          .first<{ id: string; sale_number: number; branch_id: string; created_at: string; status: string }>();
        if (existing) {
          if (existing.status !== "completed") {
            return c.json(
              { success: false, error: { code: "SALE_NOT_COMPLETABLE", status: existing.status } },
              409,
            );
          }
          return c.json({
            success: true,
            data: {
              id: existing.id,
              sale_number: existing.sale_number,
              branch_id: existing.branch_id,
              created_at: existing.created_at,
              idempotent_replay: true,
            },
          }, 200);
        }
      }

      // 2) Colisión en UNIQUE (branch_id, sale_number) → reintentar con MAX+1 fresco.
      const isSaleNumberConflict = /UNIQUE/i.test(message) &&
        (/sale_number/i.test(message) || /uq_sales_branch_sale_number/i.test(message));
      if (isSaleNumberConflict) {
        attempts++;
        continue;
      }

      throw err;
    }
  }

  if (!inserted) {
    // NOTA: a diferencia de la versión anterior, acá NO queda un hueco en
    // document_sequences — el UPDATE de la secuencia vive dentro del mismo
    // db.batch() que falló en cada intento, así que D1 revirtió también ese
    // incremento junto con el resto (todo-o-nada). Agotar
    // MAX_SALE_NUMBER_RETRIES reintentos de sale_number sigue siendo un fallo
    // catastrófico (500), pero ya no consume numeración fiscal sin comprobante.
    return c.json(
      { success: false, error: { code: "SALE_NUMBER_CONFLICT", message: "No se pudo generar número de venta único tras varios reintentos" } },
      500,
    );
  }

  return c.json(
    {
      success: true,
      data: {
        id: saleId,
        sale_number: saleNumber,
        branch_id: branchId,
        created_at: now,
        document_type: documentType,
        document_number: documentNumber,
      },
    },
    201,
  );
});

// POST /:id/void
salesRoutes.post("/:id/void", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ void_reason?: string }>().catch((): { void_reason?: string } => ({}));

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  // SECURITY: voiding a sale reverses inventory and erases the revenue from
  // reports — restrict to supervisor and up so a single rogue cashier cannot
  // void their own sales to cover theft.
  const voidRole = c.get("userRole");
  if (voidRole !== "admin" && voidRole !== "owner" && voidRole !== "supervisor") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para anular ventas" } }, 403);
  }

  const sale = await db
    .prepare("SELECT id, status FROM sales WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!sale) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Venta no encontrada" } }, 404);
  }

  if (sale.status !== "completed") {
    return c.json(
      { success: false, error: { code: "CONFLICT", message: `No se puede anular la venta: estado actual '${sale.status}'` } },
      409,
    );
  }

  const voidedAt = nowSqliteTs();

  // Atomic guard: only void if still 'completed'. Under concurrency, two requests
  // that both pass the SELECT above can race here — the second will see changes=0.
  const voidUpdate = await db
    .prepare(
      `UPDATE sales SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, sync_status = 'pending'
       WHERE id = ? AND status = 'completed'`
    )
    .bind(voidedAt, userId, (body as { void_reason?: string }).void_reason ?? null, id)
    .run();

  if (voidUpdate.meta.changes === 0) {
    return c.json(
      { success: false, error: { code: "ALREADY_VOIDED" } },
      409,
    );
  }

  const saleItems = await db
    .prepare("SELECT product_id, quantity FROM sale_items WHERE sale_id = ?")
    .bind(id)
    .all<{ product_id: string; quantity: number }>();

  const stockStatements = (saleItems.results ?? []).flatMap(item => {
    const movementId = genId();
    return [
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, (SELECT branch_id FROM sales WHERE id = ?), 'return_in', ?, 'Anulación de venta', ?, ?)`
      ).bind(movementId, item.product_id, id, item.quantity, userId, voidedAt),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
         WHERE product_id = ? AND branch_id = (SELECT branch_id FROM sales WHERE id = ?)`
      ).bind(item.quantity, voidedAt, item.product_id, id),
    ];
  });

  if (stockStatements.length > 0) {
    await db.batch(stockStatements);
  }

  return c.json({ success: true, data: { id, voided_at: voidedAt } });
});

// POST /:id/refund
salesRoutes.post("/:id/refund", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ reason?: string; items?: { sale_item_id?: string; product_id?: string; quantity: number }[] }>()
    .catch(() => ({}) as { reason?: string; items?: { sale_item_id?: string; product_id?: string; quantity: number }[] });

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);

  // SECURITY: same rationale as void — refunds reverse cash and inventory.
  const refundRole = c.get("userRole");
  if (refundRole !== "admin" && refundRole !== "owner" && refundRole !== "supervisor") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para reembolsar ventas" } }, 403);
  }

  const sale = await db
    .prepare(
      `SELECT s.*, u.name AS cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; status: string; branch_id: string }>();

  if (!sale) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Venta no encontrada" } }, 404);
  if (sale.status === "voided") {
    return c.json({ success: false, error: { code: "CONFLICT", message: "La venta ya fue anulada" } }, 409);
  }
  if (sale.status === "refunded") {
    return c.json({ success: false, error: { code: "CONFLICT", message: "La venta ya fue reembolsada" } }, 409);
  }

  const saleItems = await db
    .prepare(
      "SELECT id, product_id, batch_id, quantity FROM sale_items WHERE sale_id = ?"
    )
    .bind(id)
    .all<{ id: string; product_id: string; batch_id: string | null; quantity: number }>();

  const allItems = saleItems.results ?? [];
  const requested = body.items ?? [];
  const partial = requested.length > 0;

  const toRefund: { product_id: string; batch_id: string | null; quantity: number }[] = [];

  if (partial) {
    // Key by sale_item id to correctly handle the same product appearing on multiple lines.
    // Also build a product_id index for backwards-compatible callers that don't send sale_item_id.
    const itemsById = new Map<
      string,
      { id: string; product_id: string; batch_id: string | null; quantity: number }
    >();
    const itemsByProduct = new Map<
      string,
      { id: string; product_id: string; batch_id: string | null; quantity: number }
    >();
    for (const it of allItems) {
      itemsById.set(it.id, it);
      // last-writer wins for product_id fallback — only safe when product appears once
      itemsByProduct.set(it.product_id, it);
    }
    for (const req of requested) {
      // Prefer explicit sale_item_id; fall back to product_id for backwards compat
      const matched = req.sale_item_id
        ? itemsById.get(req.sale_item_id)
        : (req.product_id ? itemsByProduct.get(req.product_id) : undefined);
      const label = req.sale_item_id ?? req.product_id ?? "(unknown)";
      if (!matched) {
        return c.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: `El item ${label} no pertenece a esta venta` } },
          400,
        );
      }
      if (!Number.isFinite(Number(req.quantity)) || req.quantity <= 0 || req.quantity > matched.quantity) {
        return c.json(
          {
            success: false,
            error: { code: "VALIDATION_ERROR", message: `La cantidad a reembolsar para ${label} debe ser un número > 0 y <= ${matched.quantity}` },
          },
          400,
        );
      }
      toRefund.push({
        product_id: matched.product_id,
        batch_id: matched.batch_id,
        quantity: req.quantity,
      });
    }
  } else {
    for (const it of allItems) {
      toRefund.push({ product_id: it.product_id, batch_id: it.batch_id, quantity: it.quantity });
    }
  }

  const refundedAt = nowSqliteTs();
  const reason = body.reason ?? "Reembolso";
  const branchId = sale.branch_id;

  // Atomic guard: only refund if not already voided or refunded — prevents a race
  // between the status SELECT above and this UPDATE.
  const refundUpdate = await db
    .prepare(
      `UPDATE sales SET status = 'refunded', refunded_at = ?, refunded_by = ?, refund_reason = ?, sync_status = 'pending'
       WHERE id = ? AND status NOT IN ('voided', 'refunded')`
    )
    .bind(refundedAt, userId, reason, id)
    .run();

  if (refundUpdate.meta.changes === 0) {
    return c.json(
      { success: false, error: { code: "CONFLICT", message: "La venta ya fue anulada o reembolsada" } },
      409,
    );
  }

  const stmts = [
    ...toRefund.flatMap((item) => {
      const movementId = genId();
      const baseStmts = [
        db.prepare(
          `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, ?, 'return_in', ?, 'Reembolso', ?, ?)`
        ).bind(movementId, item.product_id, branchId, item.quantity, userId, refundedAt),
        db.prepare(
          `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
           WHERE product_id = ? AND branch_id = ?`
        ).bind(item.quantity, refundedAt, item.product_id, branchId),
      ];
      if (item.batch_id) {
        baseStmts.push(
          db.prepare(
            `UPDATE inventory_batches SET remaining_quantity = remaining_quantity + ? WHERE id = ?`
          ).bind(item.quantity, item.batch_id)
        );
      }
      return baseStmts;
    }),
  ];

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return c.json({
    success: true,
    data: { id, refunded_at: refundedAt, items_refunded: toRefund.length },
  });
});

// GET /:id/receipt
salesRoutes.get("/:id/receipt", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const format = c.req.query("format") ?? "json";
  if (format !== "json" && format !== "html") {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: 'format debe ser "json" o "html"' } }, 400);
  }

  const sale = await db
    .prepare(
      `SELECT s.*,
        u.name AS cashier_name,
        c.name AS customer_name, c.document_type, c.phone AS customer_phone
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? LIMIT 1`
    )
    .bind(id)
    .first<{
      id: string;
      sale_number: number;
      branch_id: string | null;
      subtotal: number;
      discount_total: number;
      tax_total: number;
      total: number;
      status: string;
      notes: string | null;
      created_at: string;
      cashier_name: string | null;
      customer_name: string | null;
      document_type: string | null;
      customer_phone: string | null;
    }>();

  if (!sale) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Venta no encontrada" } }, 404);

  // SECURITY: mismo guard de sucursal que GET /:id — el recibo expone todos los
  // datos de la venta, incluyendo cliente y método de pago.
  const receiptUserRole = c.get("userRole");
  const receiptTokenBranchId = c.get("branchId");
  if (sale.branch_id && sale.branch_id !== receiptTokenBranchId && receiptUserRole !== "admin" && receiptUserRole !== "owner") {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "La venta pertenece a otra sucursal" } }, 403);
  }

  const [itemsResult, paymentsResult, branch] = await Promise.all([
    db
      .prepare(
        `SELECT si.*, p.name AS product_name, p.code AS product_code
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = ?
         ORDER BY si.created_at`
      )
      .bind(id)
      .all<{
        product_name: string | null;
        product_code: string | null;
        quantity: number;
        unit_price: number;
        total: number;
      }>(),
    db
      .prepare(
        "SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at"
      )
      .bind(id)
      .all<{ payment_method: string; amount: number }>(),
    db
      .prepare("SELECT name, address, phone FROM branches WHERE id = ? LIMIT 1")
      .bind(sale.branch_id ?? DEFAULT_BRANCH_ID)
      .first<{ name: string; address: string | null; phone: string | null }>(),
  ]);

  const items = itemsResult.results ?? [];
  const payments = paymentsResult.results ?? [];

  if (format === "json") {
    return c.json({
      success: true,
      data: { sale, items, payments, branch },
    });
  }

  const html = renderReceiptHtml({ sale, items, payments, branch });
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

interface ReceiptData {
  sale: {
    id: string;
    sale_number: number;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    status: string;
    created_at: string;
    cashier_name: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  };
  items: {
    product_name: string | null;
    product_code: string | null;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  payments: { payment_method: string; amount: number }[];
  branch: { name: string; address: string | null; phone: string | null } | null;
}

function escapeHtml(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function renderReceiptHtml(data: ReceiptData): string {
  const { sale, items, payments, branch } = data;
  const banner =
    sale.status === "voided"
      ? `<div class="banner">ANULADA</div>`
      : sale.status === "refunded"
        ? `<div class="banner">REEMBOLSADA</div>`
        : "";

  const itemsRows = items
    .map(
      (it) => `
      <tr>
        <td colspan="3" class="item-name">${escapeHtml(it.product_name ?? it.product_code ?? "")}</td>
      </tr>
      <tr>
        <td>${it.quantity}</td>
        <td>${formatCurrency(it.unit_price)}</td>
        <td class="right">${formatCurrency(it.total)}</td>
      </tr>`
    )
    .join("");

  const paymentRows = payments
    .map(
      (p) =>
        `<tr><td colspan="2">${escapeHtml(p.payment_method)}</td><td class="right">${formatCurrency(p.amount)}</td></tr>`
    )
    .join("");

  const customerBlock = sale.customer_name
    ? `<div class="row">Cliente: ${escapeHtml(sale.customer_name)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Ticket #${sale.sale_number}</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 11px; max-width: 300px; margin: 0 auto; padding: 8px; color: #000; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .row { margin: 2px 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 2px; vertical-align: top; }
  .item-name { font-weight: bold; }
  .totals td { padding-top: 2px; }
  .banner { background: #c00; color: #fff; text-align: center; padding: 4px; font-weight: bold; margin: 6px 0; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(branch?.name ?? "")}</h1>
  ${branch?.address ? `<div class="center">${escapeHtml(branch.address)}</div>` : ""}
  ${branch?.phone ? `<div class="center">Tel: ${escapeHtml(branch.phone)}</div>` : ""}
  <hr />
  ${banner}
  <div class="row">Ticket #${sale.sale_number}</div>
  <div class="row">Fecha: ${escapeHtml(sale.created_at)}</div>
  <div class="row">Cajero: ${escapeHtml(sale.cashier_name ?? "")}</div>
  ${customerBlock}
  <hr />
  <table>
    <thead>
      <tr><td>Cant</td><td>P.U.</td><td class="right">Subt.</td></tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>
  <hr />
  <table class="totals">
    <tr><td colspan="2">Subtotal</td><td class="right">${formatCurrency(sale.subtotal)}</td></tr>
    <tr><td colspan="2">Descuento</td><td class="right">${formatCurrency(sale.discount_total)}</td></tr>
    <tr><td colspan="2">IVA</td><td class="right">${formatCurrency(sale.tax_total)}</td></tr>
    <tr><td colspan="2"><strong>TOTAL</strong></td><td class="right"><strong>${formatCurrency(sale.total)}</strong></td></tr>
  </table>
  <hr />
  <table>
    ${paymentRows}
  </table>
  <hr />
  <div class="center">Gracias por su compra</div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}
