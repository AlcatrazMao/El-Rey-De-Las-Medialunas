import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const cashRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";
const FALLBACK_USER = "00000000000000000000000000000001";

async function resolveUser(
  db: D1Database,
  authHeader: string | null
): Promise<{ id: string } | null> {
  if (!authHeader) return null;
  try {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const firebaseUid: string | undefined =
      payload.user_id ?? payload.uid ?? payload.sub;
    if (!firebaseUid) return null;
    const row = await db
      .prepare(
        "SELECT id FROM users WHERE firebase_uid = ? AND is_active = 1 LIMIT 1"
      )
      .bind(firebaseUid)
      .first<{ id: string }>();
    return row ?? null;
  } catch {
    return null;
  }
}

// GET /sessions
cashRoutes.get("/sessions", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const status = c.req.query("status");
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

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

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const user = await resolveUser(db, c.req.header("Authorization") ?? null);
  const userId = user?.id ?? FALLBACK_USER;

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

  const user = await resolveUser(db, c.req.header("Authorization") ?? null);
  const userId = user?.id ?? FALLBACK_USER;

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
