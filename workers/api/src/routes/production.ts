import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";

export const productionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_BRANCH = "00000000000000000000000000000001";

// ── Recipes ───────────────────────────────────────────────────────────

// GET /recipes
productionRoutes.get("/recipes", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const search = c.req.query("search");
  const isActive = c.req.query("is_active");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  let query = `
    SELECT r.*, p.name as product_name, p.unit as product_unit
    FROM production_recipes r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE p.branch_id = ?`;
  const bindings: (string | number)[] = [branchId];

  if (search) {
    query += " AND (r.name LIKE ? OR p.name LIKE ?)";
    const like = `%${search}%`;
    bindings.push(like, like);
  }
  if (isActive !== undefined) {
    query += " AND r.is_active = ?";
    bindings.push(isActive === "false" ? 0 : 1);
  }

  query += " ORDER BY r.name ASC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db.prepare(query).bind(...bindings).all();
  return c.json({ success: true, data: results.results ?? [] });
});

// GET /recipes/:id — with ingredients
productionRoutes.get("/recipes/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const recipe = await db
    .prepare(
      `SELECT r.*, p.name as product_name, p.unit as product_unit
       FROM production_recipes r
       LEFT JOIN products p ON p.id = r.product_id
       WHERE r.id = ? LIMIT 1`
    )
    .bind(id)
    .first();

  if (!recipe) return c.json({ success: false, error: "Recipe not found" }, 404);

  const ingredients = await db
    .prepare(
      `SELECT ri.*, p.name as ingredient_name, p.unit as ingredient_unit, p.cost as ingredient_cost
       FROM recipe_ingredients ri
       LEFT JOIN products p ON p.id = ri.ingredient_product_id
       WHERE ri.recipe_id = ? ORDER BY ri.sort_order ASC`
    )
    .bind(id)
    .all();

  return c.json({ success: true, data: { ...recipe, ingredients: ingredients.results ?? [] } });
});

// POST /recipes
productionRoutes.post("/recipes", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    product_id: string;
    name: string;
    yield_quantity: number;
    preparation_instructions?: string;
    ingredients: {
      ingredient_product_id: string;
      quantity: number;
      unit: string;
      waste_percentage?: number;
      sort_order?: number;
    }[];
  }>();

  if (!body.product_id) return c.json({ success: false, error: "product_id is required" }, 400);
  if (!body.name?.trim()) return c.json({ success: false, error: "name is required" }, 400);
  if (!body.yield_quantity || body.yield_quantity <= 0) return c.json({ success: false, error: "yield_quantity must be > 0" }, 400);
  if (!Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    return c.json({ success: false, error: "ingredients is required and must not be empty" }, 400);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  const statements = [
    db.prepare(
      `INSERT INTO production_recipes (id, product_id, name, yield_quantity, preparation_instructions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, body.product_id, body.name.trim(), body.yield_quantity, body.preparation_instructions ?? null, now, now),
    ...body.ingredients.map((ing, idx) => {
      const ingId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
      return db.prepare(
        `INSERT INTO recipe_ingredients (id, recipe_id, ingredient_product_id, quantity, unit, waste_percentage, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ingId, id, ing.ingredient_product_id, ing.quantity, ing.unit, ing.waste_percentage ?? 5.0, ing.sort_order ?? idx, now);
    }),
  ];

  await db.batch(statements);
  return c.json({ success: true, data: { id } }, 201);
});

// PUT /recipes/:id
productionRoutes.put("/recipes/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    yield_quantity?: number;
    preparation_instructions?: string | null;
    is_active?: boolean;
  }>();

  const existing = await db
    .prepare("SELECT id FROM production_recipes WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Recipe not found" }, 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.yield_quantity !== undefined) { fields.push("yield_quantity = ?"); vals.push(body.yield_quantity); }
  if (body.preparation_instructions !== undefined) { fields.push("preparation_instructions = ?"); vals.push(body.preparation_instructions ?? null); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) return c.json({ success: false, error: "No fields to update" }, 400);

  fields.push("updated_at = ?", "version = version + 1");
  vals.push(now, id);

  await db.prepare(`UPDATE production_recipes SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true, data: { id, updated_at: now } });
});

// ── Production Batches ────────────────────────────────────────────────

// GET /batches
productionRoutes.get("/batches", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH;
  const status = c.req.query("status");
  const recipeId = c.req.query("recipe_id");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  let query = `
    SELECT pb.*, r.name as recipe_name, p.name as product_name
    FROM production_batches pb
    LEFT JOIN production_recipes r ON r.id = pb.recipe_id
    LEFT JOIN products p ON p.id = r.product_id
    WHERE pb.branch_id = ?`;
  const bindings: (string | number)[] = [branchId];

  if (status) { query += " AND pb.status = ?"; bindings.push(status); }
  if (recipeId) { query += " AND pb.recipe_id = ?"; bindings.push(recipeId); }

  query += " ORDER BY pb.planned_at DESC LIMIT ? OFFSET ?";
  bindings.push(limit, offset);

  const results = await db.prepare(query).bind(...bindings).all();
  return c.json({ success: true, data: results.results ?? [] });
});

// POST /batches — plan a new production batch
productionRoutes.post("/batches", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    recipe_id: string;
    branch_id?: string;
    planned_quantity: number;
    notes?: string;
  }>();

  if (!body.recipe_id) return c.json({ success: false, error: "recipe_id is required" }, 400);
  if (!body.planned_quantity || body.planned_quantity <= 0) {
    return c.json({ success: false, error: "planned_quantity must be > 0" }, 400);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const recipe = await db
    .prepare("SELECT id FROM production_recipes WHERE id = ? AND is_active = 1 LIMIT 1")
    .bind(body.recipe_id)
    .first<{ id: string }>();
  if (!recipe) return c.json({ success: false, error: "Recipe not found or inactive" }, 404);

  const branchId = body.branch_id ?? DEFAULT_BRANCH;
  const id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await db
    .prepare(
      `INSERT INTO production_batches (id, recipe_id, branch_id, user_id, planned_quantity, planned_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, body.recipe_id, branchId, user.id, body.planned_quantity, now)
    .run();

  return c.json({ success: true, data: { id } }, 201);
});

// POST /batches/:id/start — consume raw ingredients from inventory
productionRoutes.post("/batches/:id/start", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const batch = await db
    .prepare(
      `SELECT pb.*, r.yield_quantity as recipe_yield
       FROM production_batches pb
       LEFT JOIN production_recipes r ON r.id = pb.recipe_id
       WHERE pb.id = ? LIMIT 1`
    )
    .bind(id)
    .first<{ id: string; recipe_id: string; branch_id: string; status: string; planned_quantity: number; recipe_yield: number; user_id: string }>();

  if (!batch) return c.json({ success: false, error: "Production batch not found" }, 404);
  if (batch.status !== "planned") {
    return c.json({ success: false, error: `Batch cannot be started: current status is '${batch.status}'` }, 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const ingredients = await db
    .prepare("SELECT * FROM recipe_ingredients WHERE recipe_id = ?")
    .bind(batch.recipe_id)
    .all<{ ingredient_product_id: string; quantity: number; waste_percentage: number }>();

  const batchMultiplier = batch.planned_quantity / (batch.recipe_yield || 1);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  const consumeStatements = (ingredients.results ?? []).flatMap(ing => {
    const totalQty = parseFloat((ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4));
    const movId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    return [
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'production_out', ?, 'Consumo lote producción', ?, ?)`
      ).bind(movId, ing.ingredient_product_id, batch.branch_id, totalQty, user.id, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
         WHERE product_id = ? AND branch_id = ?`
      ).bind(totalQty, now, ing.ingredient_product_id, batch.branch_id),
    ];
  });

  consumeStatements.push(
    db.prepare("UPDATE production_batches SET status = 'in_progress', started_at = ? WHERE id = ?")
      .bind(now, id)
  );

  await db.batch(consumeStatements);
  return c.json({ success: true, data: { id, status: "in_progress", started_at: now } });
});

// POST /batches/:id/complete — add finished product to inventory
productionRoutes.post("/batches/:id/complete", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ actual_quantity: number; waste_quantity?: number; notes?: string }>().catch((): { actual_quantity: number; waste_quantity?: number; notes?: string } => ({
    actual_quantity: 0, waste_quantity: 0, notes: undefined,
  }));

  if (!body.actual_quantity || body.actual_quantity <= 0) {
    return c.json({ success: false, error: "actual_quantity must be > 0" }, 400);
  }

  const batch = await db
    .prepare(
      `SELECT pb.*, r.product_id as output_product_id
       FROM production_batches pb
       LEFT JOIN production_recipes r ON r.id = pb.recipe_id
       WHERE pb.id = ? LIMIT 1`
    )
    .bind(id)
    .first<{ id: string; branch_id: string; status: string; output_product_id: string; user_id: string }>();

  if (!batch) return c.json({ success: false, error: "Production batch not found" }, 404);
  if (batch.status !== "in_progress") {
    return c.json({ success: false, error: `Batch cannot be completed: current status is '${batch.status}'` }, 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const movId = crypto.randomUUID().replace(/-/g, "").toLowerCase();

  const completeStatements = [
    db.prepare(
      `UPDATE production_batches
       SET status = 'completed', actual_quantity = ?, waste_quantity = ?, notes = ?, completed_at = ?
       WHERE id = ?`
    ).bind(body.actual_quantity, body.waste_quantity ?? 0, body.notes ?? null, now, id),
    db.prepare(
      `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
       VALUES (?, ?, ?, 'production_in', ?, 'Producción completada', ?, ?)`
    ).bind(movId, batch.output_product_id, batch.branch_id, body.actual_quantity, user.id, now),
    db.prepare(
      `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
       WHERE product_id = ? AND branch_id = ?`
    ).bind(body.actual_quantity, now, batch.output_product_id, batch.branch_id),
  ];

  await db.batch(completeStatements);
  return c.json({ success: true, data: { id, status: "completed", actual_quantity: body.actual_quantity, completed_at: now } });
});

// POST /batches/:id/cancel
productionRoutes.post("/batches/:id/cancel", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const batch = await db
    .prepare("SELECT id, status FROM production_batches WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!batch) return c.json({ success: false, error: "Production batch not found" }, 404);
  if (batch.status === "completed") {
    return c.json({ success: false, error: "Cannot cancel a completed batch" }, 409);
  }
  if (batch.status === "cancelled") {
    return c.json({ success: false, error: "Batch is already cancelled" }, 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: "User not registered" }, 403);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .prepare("UPDATE production_batches SET status = 'cancelled' WHERE id = ?")
    .bind(id)
    .run();

  return c.json({ success: true, data: { id, status: "cancelled", updated_at: now } });
});
