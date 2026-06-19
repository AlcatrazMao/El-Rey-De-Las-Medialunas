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

// POST /sessions/open
cashRoutes.post("/sessions/open", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    id?: string;
    opening_amount: number;
    notes?: string;
    branch_id?: string;
  }>();

  if (typeof body.opening_amount !== 'number' || body.opening_amount < 0) {
    return c.json({ success: false, error: 'opening_amount must be a non-negative number' }, 400);
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const existing = await db
    .prepare(
      "SELECT id FROM cash_sessions WHERE branch_id = ? AND status = 'open' LIMIT 1"
    )
    .bind(branchId)
    .first<{ id: string }>();

  if (existing) {
    return c.json(
      { success: false, error: "There is already an open session for this branch" },
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
    return c.json({ success: false, error: "Open session not found" }, 404);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

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
    return c.json({ success: false, error: "session_id is required" }, 400);
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
    return c.json({ success: false, error: 'cash_session_id is required' }, 400);
  }

  const VALID_MOVEMENT_TYPES = ['income', 'expense', 'adjustment'];
  if (!VALID_MOVEMENT_TYPES.includes(body.type)) {
    return c.json(
      { success: false, error: `type must be one of: ${VALID_MOVEMENT_TYPES.join(', ')}` },
      400
    );
  }

  if (typeof body.amount !== 'number' || body.amount <= 0) {
    return c.json({ success: false, error: 'amount must be a number greater than 0' }, 400);
  }

  const session = await db
    .prepare("SELECT id, status FROM cash_sessions WHERE id = ? LIMIT 1")
    .bind(body.cash_session_id)
    .first<{ id: string; status: string }>();

  if (!session) {
    return c.json({ success: false, error: 'Cash session not found' }, 404);
  }

  if (session.status !== 'open') {
    return c.json({ success: false, error: 'Cash session is not open' }, 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

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
