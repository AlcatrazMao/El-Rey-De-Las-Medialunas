import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const cashRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /sessions
cashRoutes.get("/sessions", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const status = c.req.query("status");
  // Cursor-based pagination: el cliente pasa el opened_at de la última sesión
  // vista como cursor. Usar opened_at en vez de id evita saltos/duplicados cuando
  // se inserta una sesión nueva mientras el usuario pagina, ya que opened_at es
  // estable y refleja el orden cronológico real de apertura de caja.
  const beforeCursor = c.req.query("before_id");
  const rawLimit = parseInt(c.req.query("limit") ?? "30", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 30 : rawLimit, 1), 100);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

  let query = "SELECT * FROM cash_sessions WHERE branch_id = ?";
  const bindings: (string | number)[] = [branchId];

  if (status) {
    query += " AND status = ?";
    bindings.push(status);
  }

  if (beforeCursor) {
    query += " AND opened_at < ?";
    bindings.push(beforeCursor);
    query += " ORDER BY opened_at DESC LIMIT ?";
    bindings.push(limit);
  } else {
    query += " ORDER BY opened_at DESC LIMIT ? OFFSET ?";
    bindings.push(limit, offset);
  }

  const results = await db
    .prepare(query)
    .bind(...bindings)
    .all<{ opened_at: string }>();

  const rows = results.results ?? [];
  const lastSession = rows[rows.length - 1];
  const nextCursor = rows.length === limit && lastSession ? lastSession.opened_at : null;

  return c.json({ success: true, data: rows, nextCursor });
});

// GET /sessions/current
cashRoutes.get("/sessions/current", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;

  const session = await db
    .prepare(
      "SELECT * FROM cash_sessions WHERE branch_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1"
    )
    .bind(branchId)
    .first();

  return c.json({ success: true, data: session ?? null });
});

// SECURITY: cap monetary amounts so a malicious or buggy client cannot
// poison cash session totals with Infinity-adjacent values.
const MAX_CASH_AMOUNT = 10_000_000; // 10 millones — más que suficiente

// Calcula el delta neto de los movements intra-sesión contra la caja:
//   income     → suma (entró plata)
//   expense    → resta (salió plata)
//   adjustment → suma o resta según el signo del amount
// Devuelve un número finito (puede ser negativo).
export function computeMovementsDelta(
  movements: { type: string; amount: number }[]
): number {
  let delta = 0;
  for (const m of movements) {
    const amt = Number(m.amount);
    if (!Number.isFinite(amt)) continue;
    if (m.type === "income") {
      delta += amt;
    } else if (m.type === "expense") {
      delta -= amt;
    } else if (m.type === "adjustment") {
      // Para adjustment respetamos el signo: valores negativos restan.
      delta += amt;
    }
  }
  return delta;
}

// Función pura para derivar el expected_amount siempre server-side.
// Fórmula: opening + cashSales - cashExpenses + movementsDelta
// El clientExpected enviado por el frontend NO se usa como base de cálculo:
// solo sirve para auditoría comparativa, nunca para producir el valor oficial.
// Esto evita el double-counting: si el frontend ya incluyó movements en su
// expected y el backend los sumaba de nuevo, la diferencia quedaba inflada/reducida
// silenciosamente en cada cierre de caja.
export function deriveExpectedAmount(params: {
  openingAmount: number;
  cashSales: number;
  cashExpenses: number;
  movementsDelta: number;
}): number {
  const opening = Number(params.openingAmount ?? 0);
  const sales = Number(params.cashSales ?? 0);
  const expenses = Number(params.cashExpenses ?? 0);
  const delta = Number(params.movementsDelta ?? 0);
  return opening + sales - expenses + delta;
}

// Roles que pueden operar la caja (abrir y cerrar sesiones).
const CASH_ALLOWED_ROLES = new Set(['cashier', 'supervisor', 'admin', 'owner']);

// POST /sessions/open
cashRoutes.post("/sessions/open", async (c) => {
  const db = c.env.DB;

  // SECURITY: solo cajeros y roles superiores pueden abrir caja.
  const userRole = c.get("userRole");
  if (!CASH_ALLOWED_ROLES.has(userRole)) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Rol no autorizado para abrir caja" } },
      403
    );
  }

  const body = await c.req.json<{
    id?: string;
    opening_amount: number;
    notes?: string;
    branch_id?: string;
  }>();

  if (
    typeof body.opening_amount !== 'number' ||
    !Number.isFinite(body.opening_amount) ||
    body.opening_amount < 0 ||
    body.opening_amount > MAX_CASH_AMOUNT
  ) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "opening_amount debe ser un número finito entre 0 y 10,000,000" } },
      400
    );
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } },
      403
    );
  }

  // SECURITY: cajeros y supervisores solo pueden abrir caja en sucursales a
  // las que pertenecen. Admin y owner tienen acceso global a todas las sucursales.
  if (userRole !== "admin" && userRole !== "owner") {
    const membership = await c.env.DB.prepare(
      "SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ? LIMIT 1"
    ).bind(user.id, branchId).first();
    if (!membership) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No tenés acceso a esa sucursal" } },
        403
      );
    }
  }

  const existing = await db
    .prepare(
      "SELECT id, opened_at, opening_amount FROM cash_sessions WHERE branch_id = ? AND status = 'open' LIMIT 1"
    )
    .bind(branchId)
    .first<{ id: string; opened_at: string; opening_amount: number }>();

  let autoClosed = false;
  if (existing) {
    // Si la sesión abierta es de un día anterior (en hora Argentina, UTC-3),
    // cerrarla automáticamente. Comparamos la fecha *comercial* argentina:
    //   - opened_at está en UTC → convertimos a ARG con '-3 hours'
    //   - 'now' lo convertimos al mismo huso para que la comparación de DATE()
    //     sea contra el día calendario argentino real.
    const isFromPreviousDay = await db
      .prepare("SELECT 1 AS is_old FROM cash_sessions WHERE id = ? AND DATE(opened_at, '-3 hours') < DATE('now', '-3 hours')")
      .bind(existing.id)
      .first<{ is_old: number }>();

    if (!isFromPreviousDay) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "Ya hay una sesión de caja abierta para esta sucursal" } },
        409
      );
    }

    // Cerrar automáticamente la sesión del día anterior.
    // IMPORTANTE: closing_amount y difference quedan NULL para indicar que no
    // hubo conteo real de caja — esto preserva la discrepancia auditable.
    // expected_amount se deja intacto para que auditoría posterior lo compare.
    // status = 'auto_closed' diferencia este cierre del cierre manual ('closed').
    const autoClosedAt = nowSqliteTs();
    await db
      .prepare(
        `UPDATE cash_sessions
         SET closing_amount = NULL, difference = NULL,
             status = 'auto_closed', notes = 'Cerrada automáticamente por apertura de nueva sesión', closed_at = ?
         WHERE id = ?`
      )
      .bind(autoClosedAt, existing.id)
      .run();
    autoClosed = true;
  }

  const id =
    body.id ??
    genId();
  const openedAt = nowSqliteTs();

  await db
    .prepare(
      `INSERT INTO cash_sessions (id, branch_id, user_id, opening_amount, notes, opened_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, branchId, user.id, body.opening_amount, body.notes ?? null, openedAt)
    .run();

  return c.json({ success: true, data: { id, opened_at: openedAt, auto_closed_previous: autoClosed } }, 201);
});

// POST /sessions/:id/close
cashRoutes.post("/sessions/:id/close", async (c) => {
  const db = c.env.DB;

  // SECURITY: solo cajeros y roles superiores pueden cerrar caja.
  const closeUserRole = c.get("userRole");
  if (!CASH_ALLOWED_ROLES.has(closeUserRole)) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Rol no autorizado para cerrar caja" } },
      403
    );
  }

  const sessionId = c.req.param("id");
  const body = await c.req.json<{
    closing_amount: number | null;
    expected_amount?: number;
    notes?: string;
  }>();

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } },
      403
    );
  }

  // SECURITY: para cajeros, solo pueden cerrar su propia sesión.
  // Supervisores, admins y owners pueden cerrar cualquier sesión de su sucursal.
  let session: { id: string; opening_amount: number; branch_id: string; opened_at: string } | null = null;
  if (closeUserRole === 'cashier') {
    session = await db
      .prepare(
        "SELECT id, opening_amount, branch_id, opened_at FROM cash_sessions WHERE id = ? AND user_id = ? AND status = 'open' LIMIT 1"
      )
      .bind(sessionId, userId)
      .first<{ id: string; opening_amount: number; branch_id: string; opened_at: string }>();

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesión de caja abierta no encontrada o no pertenece a tu usuario" } },
        404
      );
    }
  } else {
    // supervisor / admin / owner: pueden cerrar cualquier sesión, pero
    // solo de sucursales a las que pertenecen (excepto admin/owner que
    // tienen acceso global).
    session = await db
      .prepare(
        "SELECT id, opening_amount, branch_id, opened_at FROM cash_sessions WHERE id = ? AND status = 'open' LIMIT 1"
      )
      .bind(sessionId)
      .first<{ id: string; opening_amount: number; branch_id: string; opened_at: string }>();

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesión de caja abierta no encontrada" } },
        404
      );
    }

    // admin y owner tienen acceso global a todas las sucursales.
    if (closeUserRole !== 'admin' && closeUserRole !== 'owner') {
      const branchRow = await db
        .prepare("SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ? LIMIT 1")
        .bind(userId, session.branch_id)
        .first<{ 1: number }>();
      if (!branchRow) {
        return c.json(
          { success: false, error: { code: "BRANCH_ACCESS_DENIED", message: "No tenés acceso a la sucursal de esta sesión" } },
          403
        );
      }
    }
  }

  // closing_amount es null cuando el cierre es automático (auto_closed por apertura
  // del día siguiente). En ese caso no validamos ni calculamos diferencia.
  const isAutoClose = body.closing_amount === null || body.closing_amount === undefined;

  if (!isAutoClose) {
    if (
      typeof body.closing_amount !== 'number' ||
      !Number.isFinite(body.closing_amount) ||
      body.closing_amount < 0 ||
      body.closing_amount > MAX_CASH_AMOUNT
    ) {
      return c.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "closing_amount debe ser un número finito entre 0 y 10,000,000" } },
        400
      );
    }
  }

  // El expected_amount del cliente se acepta solo para auditoría / logging;
  // NUNCA se usa como base del cálculo oficial. El servidor lo deriva siempre
  // desde primitivos para evitar double-counting de movements.
  if (body.expected_amount !== undefined && body.expected_amount !== null) {
    if (
      typeof body.expected_amount !== 'number' ||
      !Number.isFinite(body.expected_amount) ||
      Math.abs(body.expected_amount) > MAX_CASH_AMOUNT
    ) {
      return c.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "expected_amount debe ser un número finito" } },
        400
      );
    }
  }

  // Derivar el expected_amount siempre server-side:
  //   1. Ventas en efectivo de la sesión (desde sale_payments → sales)
  //   2. Gastos en efectivo (cash_movements de tipo expense)
  //   3. Delta neto de movements intra-sesión (income/expense/adjustment)
  const cashSalesRow = await db
    .prepare(
      `SELECT COALESCE(SUM(sp.amount), 0) AS total
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE sp.payment_method = 'cash'
         AND s.branch_id = ?
         AND s.created_at >= ?
         AND s.status = 'completed'`
    )
    .bind(session.branch_id, session.opened_at)
    .first<{ total: number }>();
  const cashSales = Number(cashSalesRow?.total ?? 0);

  const movementsResult = await db
    .prepare(
      "SELECT type, amount FROM cash_movements WHERE cash_session_id = ?"
    )
    .bind(sessionId)
    .all<{ type: string; amount: number }>();
  const movements = movementsResult.results ?? [];

  // Gastos en efectivo = movements de tipo 'expense' (ya representan plata que
  // salió de la caja por concepto de gasto, no por venta). Los movements de tipo
  // 'income' y 'adjustment' van en el delta.
  // computeMovementsDelta ya resta expenses y suma income/adjustment, así que el
  // delta neto es el número correcto para pasarle a deriveExpectedAmount donde
  // cashExpenses=0 (los expenses ya están descontados en movementsDelta).
  const movementsDelta = computeMovementsDelta(movements);

  const expectedAmount = deriveExpectedAmount({
    openingAmount: Number(session.opening_amount ?? 0),
    cashSales,
    cashExpenses: 0,   // ya incluido con signo negativo en movementsDelta
    movementsDelta,
  });

  const closingAmount = isAutoClose ? null : (body.closing_amount as number);
  const difference = closingAmount !== null ? closingAmount - expectedAmount : null;
  const closedAt = nowSqliteTs();

  // Cierre manual: status = 'closed'. Cierre automático: status = 'auto_closed'
  // (closing_amount y difference quedan NULL para indicar que no hubo conteo real).
  const closeStatus = isAutoClose ? 'auto_closed' : 'closed';
  const closeNotes = isAutoClose
    ? (body.notes ?? 'Cerrada automáticamente — requiere reconciliación de supervisor')
    : (body.notes ?? null);

  await db
    .prepare(
      `UPDATE cash_sessions
       SET closing_amount = ?, expected_amount = ?, difference = ?,
           status = ?, notes = ?, closed_at = ?
       WHERE id = ?`
    )
    .bind(
      closingAmount,
      expectedAmount,
      difference,
      closeStatus,
      closeNotes,
      closedAt,
      sessionId
    )
    .run();

  return c.json({ success: true, data: { id: sessionId, difference, closed_at: closedAt } });
});

// GET /movements
cashRoutes.get("/movements", async (c) => {
  const db = c.env.DB;
  const sessionId = c.req.query("session_id");

  if (!sessionId) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "session_id es requerido" } },
      400
    );
  }

  const results = await db
    .prepare(
      "SELECT * FROM cash_movements WHERE cash_session_id = ? ORDER BY created_at ASC"
    )
    .bind(sessionId)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// POST /movements
cashRoutes.post("/movements", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    cash_session_id: string;
    type: string;
    amount: number;
    description?: string;
    category?: string;
  }>();

  if (!body.cash_session_id || typeof body.cash_session_id !== 'string') {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "cash_session_id es requerido" } },
      400
    );
  }

  const VALID_MOVEMENT_TYPES = ['income', 'expense', 'adjustment'];
  if (!VALID_MOVEMENT_TYPES.includes(body.type)) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: `type debe ser uno de: ${VALID_MOVEMENT_TYPES.join(', ')}` } },
      400
    );
  }

  // Para 'adjustment', amount=0 es válido: "se contó la caja y dio igual" sirve
  // para auditoría. Para 'income' y 'expense', debe ser estrictamente positivo.
  const amountIsFinite = typeof body.amount === 'number' && Number.isFinite(body.amount);
  const amountAboveMin = body.type === 'adjustment' ? body.amount >= 0 : body.amount > 0;
  if (!amountIsFinite || !amountAboveMin || body.amount > MAX_CASH_AMOUNT) {
    const msg = body.type === 'adjustment'
      ? "amount debe ser un número finito >= 0 y <= 10,000,000"
      : "amount debe ser un número finito > 0 y <= 10,000,000";
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: msg } },
      400
    );
  }

  const session = await db
    .prepare("SELECT id, status FROM cash_sessions WHERE id = ? LIMIT 1")
    .bind(body.cash_session_id)
    .first<{ id: string; status: string }>();

  if (!session) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sesión de caja no encontrada" } },
      404
    );
  }

  if (session.status !== 'open') {
    return c.json(
      { success: false, error: { code: "CONFLICT", message: "La sesión de caja no está abierta" } },
      409
    );
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } },
      403
    );
  }

  // SECURITY: only admin/owner/supervisor can register 'expense' or 'adjustment'
  // movements. Income (deposit) can be made by any authenticated cashier. This
  // prevents a cashier from generating cash withdrawals to balance a stolen
  // till without supervisor approval.
  const userRole = c.get("userRole");
  if (
    (body.type === 'expense' || body.type === 'adjustment') &&
    userRole !== 'admin' &&
    userRole !== 'owner' &&
    userRole !== 'supervisor'
  ) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "No tienes permisos para registrar este tipo de movimiento" } },
      403,
    );
  }

  const id = genId();
  const createdAt = nowSqliteTs();

  await db
    .prepare(
      `INSERT INTO cash_movements (id, cash_session_id, user_id, type, amount, description, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      body.cash_session_id,
      user.id,
      body.type,
      body.amount,
      body.description ?? null,
      body.category ?? null,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});
