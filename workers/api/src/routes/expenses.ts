import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const expenseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

const VALID_CATEGORIES = new Set([
  "materia_prima",
  "servicios",
  "alquiler",
  "salarios",
  "otros",
]);

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
  const firebaseUid = c.get("firebaseUid") ?? "";
  const user = await resolveUser(c.env.DB, firebaseUid);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);
  const userId = user.id;

  const id = body.id ?? crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  const result = await db
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

  if (!result.meta?.changes) {
    // ID duplicado — el gasto ya existe, retornar el existente
    return c.json({ success: true, data: { id, already_existed: true } }, 200);
  }

  return c.json({ success: true, data: { id } }, 201);
});
