import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const cashRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// GET /sessions
cashRoutes.get("/sessions", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const status = c.req.query("status");
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

  query += " ORDER BY opened_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db
    .prepare(query)
    .bind(...bindings)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /sessions/current
cashRoutes.get("/sessions/current", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;

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

// POST /sessions/open
cashRoutes.post("/sessions/open", async (c) => {
  const db = c.env.DB;
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

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } },
      403
    );
  }

  const existing = await db
    .prepare(
      "SELECT id FROM cash_sessions WHERE branch_id = ? AND status = 'open' LIMIT 1"
    )
    .bind(branchId)
    .first<{ id: string }>();

  if (existing) {
    return c.json(
      { success: false, error: { code: "CONFLICT", message: "Ya hay una sesión de caja abierta para esta sucursal" } },
      409
    );
  }

  const id =
    body.id ??
    crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const openedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT INTO cash_sessions (id, branch_id, user_id, opening_amount, notes, opened_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, branchId, userId, body.opening_amount, body.notes ?? null, openedAt)
    .run();

  return c.json({ success: true, data: { id, opened_at: openedAt } }, 201);
});

// POST /sessions/:id/close
cashRoutes.post("/sessions/:id/close", async (c) => {
  const db = c.env.DB;
  const sessionId = c.req.param("id");
  const body = await c.req.json<{
    closing_amount: number;
    expected_amount?: number;
    notes?: string;
  }>();

  const session = await db
    .prepare(
      "SELECT id FROM cash_sessions WHERE id = ? AND status = 'open' LIMIT 1"
    )
    .bind(sessionId)
    .first<{ id: string }>();

  if (!session) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sesión de caja abierta no encontrada" } },
      404
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

  const closingAmount = body.closing_amount;
  const expectedAmount = body.expected_amount ?? null;
  const difference =
    expectedAmount !== null ? closingAmount - expectedAmount : null;
  const closedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `UPDATE cash_sessions
       SET closing_amount = ?, expected_amount = ?, difference = ?,
           status = 'closed', notes = ?, closed_at = ?
       WHERE id = ?`
    )
    .bind(
      closingAmount,
      expectedAmount,
      difference,
      body.notes ?? null,
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

  if (
    typeof body.amount !== 'number' ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0 ||
    body.amount > MAX_CASH_AMOUNT
  ) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "amount debe ser un número finito > 0 y <= 10,000,000" } },
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

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT INTO cash_movements (id, cash_session_id, user_id, type, amount, description, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      body.cash_session_id,
      userId,
      body.type,
      body.amount,
      body.description ?? null,
      body.category ?? null,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});
