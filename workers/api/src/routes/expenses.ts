import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const expenseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";
const FALLBACK_USER = "00000000000000000000000000000001";

const VALID_CATEGORIES = new Set([
  "materia_prima",
  "servicios",
  "alquiler",
  "salarios",
  "otros",
]);

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
    const encodedPayload = parts[1];
    if (parts.length < 2 || !encodedPayload) return null;
    const payload = JSON.parse(
      atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"))
    );
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

// GET /
expenseRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const category = c.req.query("category");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  let query = "SELECT * FROM expenses WHERE branch_id = ?";
  const bindings: (string | number)[] = [branchId];

  if (category) {
    query += " AND category = ?";
    bindings.push(category);
  }
  if (fromDate) {
    query += " AND created_at >= ?";
    bindings.push(fromDate);
  }
  if (toDate) {
    query += " AND created_at <= ?";
    bindings.push(toDate);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db
    .prepare(query)
    .bind(...bindings)
    .all();

  return c.json({ success: true, data: results.results ?? [] });
});

// GET /:id
expenseRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const row = await db
    .prepare("SELECT * FROM expenses WHERE id = ? LIMIT 1")
    .bind(id)
    .first();

  if (!row) {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }

  return c.json({ success: true, data: row });
});

// POST /
expenseRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    id?: string;
    concept: string;
    category: string;
    amount: number;
    payment_method: string;
    invoice_url?: string;
    branch_id?: string;
  }>();

  if (!body.concept || !body.category || body.amount === undefined || !body.payment_method) {
    return c.json(
      { success: false, error: "concept, category, amount, and payment_method are required" },
      400
    );
  }

  if (!VALID_CATEGORIES.has(body.category)) {
    return c.json(
      {
        success: false,
        error: `category must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
      },
      400
    );
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const user = await resolveUser(db, c.req.header("Authorization") ?? null);
  const userId = user?.id ?? FALLBACK_USER;

  const id = body.id ?? crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT OR IGNORE INTO expenses
         (id, branch_id, user_id, concept, category, amount, payment_method, invoice_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      branchId,
      userId,
      body.concept,
      body.category,
      body.amount,
      body.payment_method,
      body.invoice_url ?? null,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id } }, 201);
});
