import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const expenseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";
// SECURITY: cap expense amount to prevent Infinity-adjacent values from
// poisoning financial reports.
const MAX_EXPENSE_AMOUNT = 10_000_000;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

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
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);

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
    const toDateStr = toDate.includes(' ') ? toDate : `${toDate} 23:59:59`;
    query += " AND created_at <= ?";
    bindings.push(toDateStr);
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
    return c.json(errBody("NOT_FOUND", "Gasto no encontrado"), 404);
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
      errBody("VALIDATION_ERROR", "concept, category, amount y payment_method son requeridos"),
      400,
    );
  }

  if (typeof body.concept !== 'string' || !body.concept.trim()) {
    return c.json(errBody("VALIDATION_ERROR", "concept es requerido"), 400);
  }
  if (typeof body.payment_method !== 'string' || !body.payment_method.trim()) {
    return c.json(errBody("VALIDATION_ERROR", "payment_method es requerido"), 400);
  }

  if (
    typeof body.amount !== 'number' ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0 ||
    body.amount > MAX_EXPENSE_AMOUNT
  ) {
    return c.json(errBody("VALIDATION_ERROR", "amount debe ser un número finito > 0 y <= 10,000,000"), 400);
  }

  if (!VALID_CATEGORIES.has(body.category)) {
    return c.json(
      errBody("VALIDATION_ERROR", `category debe ser uno de: ${[...VALID_CATEGORIES].join(", ")}`),
      400,
    );
  }

  if (body.id !== undefined) {
    if (!/^[0-9a-f]{32}$/i.test(body.id)) {
      return c.json(errBody("VALIDATION_ERROR", "id debe ser un string hexadecimal de 32 caracteres (UUID sin guiones)"), 400);
    }
  }

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  // SECURITY: only admin/owner/supervisor can register expenses. Expenses
  // directly affect the P&L, so cashiers must not be able to create them.
  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para registrar gastos"), 403);
  }

  const id = body.id ?? crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO expenses
         (id, branch_id, user_id, concept, category, amount, payment_method, invoice_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      branchId,
      userId,
      body.concept.trim(),
      body.category,
      body.amount,
      body.payment_method.trim(),
      body.invoice_url ?? null,
      createdAt,
    )
    .run();

  if (!result.meta?.changes) {
    // ID duplicado — el gasto ya existe, retornar el existente
    return c.json({ success: true, data: { id, already_existed: true } }, 200);
  }

  return c.json({ success: true, data: { id } }, 201);
});
