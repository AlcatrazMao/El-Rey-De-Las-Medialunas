import { Hono } from "hono";

import { DEFAULT_BRANCH_ID } from "../config/constants";
import { resolveUser } from "../lib/resolve-user";
import type { Env, Variables } from "../types/bindings";
import { genId } from "../utils/id";
import { nowSqliteTs } from "../utils/time";

export const productionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
// SECURITY: cap quantities to keep production math from exploding.
const MAX_QUANTITY = 1_000_000;
const MAX_INGREDIENTS_PER_RECIPE = 200;

const errBody = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

// ── Recipes ───────────────────────────────────────────────────────────

// GET /recipes
productionRoutes.get("/recipes", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const search = c.req.query("search");
  const isActive = c.req.query("is_active");
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

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
       WHERE r.id = ? LIMIT 1`,
    )
    .bind(id)
    .first();

  if (!recipe) return c.json(errBody("NOT_FOUND", "Receta no encontrada"), 404);

  const ingredients = await db
    .prepare(
      `SELECT ri.*, p.name as ingredient_name, p.unit as ingredient_unit, p.cost as ingredient_cost
       FROM recipe_ingredients ri
       LEFT JOIN products p ON p.id = ri.ingredient_product_id
       WHERE ri.recipe_id = ? ORDER BY ri.sort_order ASC`,
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

  if (!body.product_id) return c.json(errBody("VALIDATION_ERROR", "product_id es requerido"), 400);
  if (!body.name?.trim()) return c.json(errBody("VALIDATION_ERROR", "name es requerido"), 400);
  if (
    typeof body.yield_quantity !== 'number' ||
    !Number.isFinite(body.yield_quantity) ||
    body.yield_quantity <= 0 ||
    body.yield_quantity > MAX_QUANTITY
  ) {
    return c.json(errBody("VALIDATION_ERROR", "yield_quantity debe ser un número finito > 0"), 400);
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    return c.json(errBody("VALIDATION_ERROR", "ingredients es requerido y no puede estar vacío"), 400);
  }
  if (body.ingredients.length > MAX_INGREDIENTS_PER_RECIPE) {
    return c.json(errBody("VALIDATION_ERROR", `Una receta no puede tener más de ${MAX_INGREDIENTS_PER_RECIPE} ingredientes`), 400);
  }
  for (const ing of body.ingredients) {
    if (!ing.ingredient_product_id || typeof ing.ingredient_product_id !== 'string') {
      return c.json(errBody("VALIDATION_ERROR", "Cada ingrediente requiere ingredient_product_id"), 400);
    }
    if (
      typeof ing.quantity !== 'number' ||
      !Number.isFinite(ing.quantity) ||
      ing.quantity <= 0 ||
      ing.quantity > MAX_QUANTITY
    ) {
      return c.json(errBody("VALIDATION_ERROR", "Cada ingrediente.quantity debe ser un número finito > 0"), 400);
    }
    if (
      ing.waste_percentage !== undefined &&
      (typeof ing.waste_percentage !== 'number' ||
        !Number.isFinite(ing.waste_percentage) ||
        ing.waste_percentage < 0 ||
        ing.waste_percentage > 100)
    ) {
      return c.json(errBody("VALIDATION_ERROR", "waste_percentage debe estar entre 0 y 100"), 400);
    }
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para crear recetas"), 403);
  }

  const id = genId();
  const now = nowSqliteTs();

  const statements = [
    db.prepare(
      `INSERT INTO production_recipes (id, product_id, name, yield_quantity, preparation_instructions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, body.product_id, body.name.trim(), body.yield_quantity, body.preparation_instructions ?? null, now, now),
    ...body.ingredients.map((ing, idx) => {
      const ingId = genId();
      return db.prepare(
        `INSERT INTO recipe_ingredients (id, recipe_id, ingredient_product_id, quantity, unit, waste_percentage, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  if (!existing) return c.json(errBody("NOT_FOUND", "Receta no encontrada"), 404);

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para modificar recetas"), 403);
  }

  if (
    body.yield_quantity !== undefined &&
    (typeof body.yield_quantity !== 'number' ||
      !Number.isFinite(body.yield_quantity) ||
      body.yield_quantity <= 0 ||
      body.yield_quantity > MAX_QUANTITY)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "yield_quantity debe ser un número finito > 0"), 400);
  }

  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = nowSqliteTs();

  if (body.name !== undefined) { fields.push("name = ?"); vals.push(body.name.trim()); }
  if (body.yield_quantity !== undefined) { fields.push("yield_quantity = ?"); vals.push(body.yield_quantity); }
  if (body.preparation_instructions !== undefined) { fields.push("preparation_instructions = ?"); vals.push(body.preparation_instructions ?? null); }
  if (body.is_active !== undefined) { fields.push("is_active = ?"); vals.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) return c.json(errBody("VALIDATION_ERROR", "No hay campos para actualizar"), 400);

  fields.push("updated_at = ?", "version = version + 1");
  vals.push(now, id);

  await db.prepare(`UPDATE production_recipes SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true, data: { id, updated_at: now } });
});

// ── Production Batches ────────────────────────────────────────────────

// GET /batches
productionRoutes.get("/batches", async (c) => {
  const db = c.env.DB;
  const branchId = c.req.query("branch_id") ?? DEFAULT_BRANCH_ID;
  const status = c.req.query("status");
  const recipeId = c.req.query("recipe_id");
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

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

  if (!body.recipe_id) return c.json(errBody("VALIDATION_ERROR", "recipe_id es requerido"), 400);
  if (
    typeof body.planned_quantity !== 'number' ||
    !Number.isFinite(body.planned_quantity) ||
    body.planned_quantity <= 0 ||
    body.planned_quantity > MAX_QUANTITY
  ) {
    return c.json(errBody("VALIDATION_ERROR", "planned_quantity debe ser un número finito > 0"), 400);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor" && userRole !== "production") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para planificar lotes de producción"), 403);
  }

  const recipe = await db
    .prepare("SELECT id FROM production_recipes WHERE id = ? AND is_active = 1 LIMIT 1")
    .bind(body.recipe_id)
    .first<{ id: string }>();
  if (!recipe) return c.json(errBody("NOT_FOUND", "Receta no encontrada o inactiva"), 404);

  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const id = genId();
  const now = nowSqliteTs();

  await db
    .prepare(
      `INSERT INTO production_batches (id, recipe_id, branch_id, user_id, planned_quantity, planned_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
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
       WHERE pb.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; recipe_id: string; branch_id: string; status: string; planned_quantity: number; recipe_yield: number; user_id: string }>();

  if (!batch) return c.json(errBody("NOT_FOUND", "Lote de producción no encontrado"), 404);
  if (batch.status !== "planned") {
    return c.json(errBody("CONFLICT", `No se puede iniciar el lote: estado actual '${batch.status}'`), 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor" && userRole !== "production") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para iniciar lotes de producción"), 403);
  }

  // Validamos recipe_yield > 0 antes de calcular el multiplicador para evitar
  // ratios con denominador 0 o negativo que generen consumos incorrectos.
  if ((batch.recipe_yield ?? 0) <= 0) {
    return c.json(errBody("VALIDATION_ERROR", "recipe_yield debe ser mayor a 0"), 400);
  }

  const ingredients = await db
    .prepare("SELECT * FROM recipe_ingredients WHERE recipe_id = ?")
    .bind(batch.recipe_id)
    .all<{ ingredient_product_id: string; quantity: number; waste_percentage: number }>();

  const batchMultiplier = batch.planned_quantity / batch.recipe_yield;
  const now = nowSqliteTs();

  // Pre-flight stock check: read current_quantity for every ingredient and
  // reject with 409 INSUFFICIENT_STOCK before touching any row.
  const ingredientList = ingredients.results ?? [];
  for (const ing of ingredientList) {
    const totalQty = parseFloat((ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4));
    const stockRow = await db
      .prepare("SELECT current_quantity FROM inventory WHERE product_id = ? AND branch_id = ? LIMIT 1")
      .bind(ing.ingredient_product_id, batch.branch_id)
      .first<{ current_quantity: number }>();
    const available = stockRow ? Number(stockRow.current_quantity) : 0;
    if (available < totalQty) {
      return c.json(
        {
          success: false as const,
          error: {
            code: "INSUFFICIENT_STOCK",
            ingredient_id: ing.ingredient_product_id,
            required: totalQty,
            available,
          },
        },
        409,
      );
    }
  }

  // Optimistic UPDATE per ingredient: WHERE current_quantity >= ? ensures that
  // a concurrent request that grabbed the stock between our check and our write
  // (race condition) results in changes=0 rather than a silent negative balance.
  const consumeStatements = ingredientList.flatMap(ing => {
    const totalQty = parseFloat((ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4));
    const movId = genId();
    return [
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'production_out', ?, 'Consumo lote producción', ?, ?)`,
      ).bind(movId, ing.ingredient_product_id, batch.branch_id, totalQty, user.id, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity - ?, updated_at = ?
         WHERE product_id = ? AND branch_id = ? AND current_quantity >= ?`,
      ).bind(totalQty, now, ing.ingredient_product_id, batch.branch_id, totalQty),
    ];
  });

  consumeStatements.push(
    db.prepare("UPDATE production_batches SET status = 'in_progress', started_at = ? WHERE id = ?")
      .bind(now, id),
  );

  // SECURITY: D1 batch limit is ~100 statements. Reject early instead of
  // letting the request silently fail.
  if (consumeStatements.length > 100) {
    return c.json(errBody("VALIDATION_ERROR", "Receta con demasiados ingredientes para una sola operación"), 400);
  }

  // D1 batch returns one result per statement. The even-indexed results (0, 2,
  // 4, …) are the stock_movements INSERTs; the odd-indexed ones (1, 3, 5, …)
  // are the inventory UPDATEs whose `changes` we must verify.
  const batchResults = await db.batch(consumeStatements);

  for (let i = 0; i < ingredientList.length; i++) {
    const updateResult = batchResults[i * 2 + 1];
    if ((updateResult?.meta?.changes ?? 0) === 0) {
      // Another request consumed the stock between our check and our write.
      return c.json(errBody("RACE_CONDITION", `Stock modificado concurrentemente para el ingrediente ${ingredientList[i]?.ingredient_product_id ?? i}`), 409);
    }
  }

  return c.json({ success: true, data: { id, status: "in_progress", started_at: now } });
});

// POST /batches/:id/complete — add finished product to inventory
productionRoutes.post("/batches/:id/complete", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ actual_quantity: number; waste_quantity?: number; notes?: string }>().catch((): { actual_quantity: number; waste_quantity?: number; notes?: string } => ({
    actual_quantity: 0, waste_quantity: 0, notes: undefined,
  }));

  if (
    typeof body.actual_quantity !== 'number' ||
    !Number.isFinite(body.actual_quantity) ||
    body.actual_quantity <= 0 ||
    body.actual_quantity > MAX_QUANTITY
  ) {
    return c.json(errBody("VALIDATION_ERROR", "actual_quantity debe ser un número finito > 0"), 400);
  }
  if (
    body.waste_quantity !== undefined &&
    (typeof body.waste_quantity !== 'number' ||
      !Number.isFinite(body.waste_quantity) ||
      body.waste_quantity < 0 ||
      body.waste_quantity > MAX_QUANTITY)
  ) {
    return c.json(errBody("VALIDATION_ERROR", "waste_quantity debe ser un número finito >= 0"), 400);
  }

  const batch = await db
    .prepare(
      `SELECT pb.*, r.product_id as output_product_id
       FROM production_batches pb
       LEFT JOIN production_recipes r ON r.id = pb.recipe_id
       WHERE pb.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; branch_id: string; status: string; output_product_id: string; user_id: string; planned_quantity: number }>();

  if (!batch) return c.json(errBody("NOT_FOUND", "Lote de producción no encontrado"), 404);
  if (batch.status !== "in_progress") {
    return c.json(errBody("CONFLICT", `No se puede completar el lote: estado actual '${batch.status}'`), 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor" && userRole !== "production") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para completar lotes de producción"), 403);
  }

  const now = nowSqliteTs();
  const movId = genId();

  // Si la cantidad real es menor a lo planeado, el lote se marca como 'partial'
  // para reflejar que no se cumplió la producción objetivo.
  const completionStatus = body.actual_quantity < batch.planned_quantity ? 'partial' : 'completed';

  const completeStatements = [
    db.prepare(
      `UPDATE production_batches
       SET status = ?, actual_quantity = ?, waste_quantity = ?, notes = ?, completed_at = ?
       WHERE id = ?`,
    ).bind(completionStatus, body.actual_quantity, body.waste_quantity ?? 0, body.notes ?? null, now, id),
    db.prepare(
      `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
       VALUES (?, ?, ?, 'production_in', ?, 'Producción completada', ?, ?)`,
    ).bind(movId, batch.output_product_id, batch.branch_id, body.actual_quantity, user.id, now),
    db.prepare(
      `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
       WHERE product_id = ? AND branch_id = ?`,
    ).bind(body.actual_quantity, now, batch.output_product_id, batch.branch_id),
  ];

  await db.batch(completeStatements);
  return c.json({ success: true, data: { id, status: completionStatus, actual_quantity: body.actual_quantity, completed_at: now } });
});

// POST /batches/:id/cancel
productionRoutes.post("/batches/:id/cancel", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const batch = await db
    .prepare(
      `SELECT pb.id, pb.status, pb.recipe_id, pb.branch_id, pb.planned_quantity, r.yield_quantity as recipe_yield
       FROM production_batches pb
       LEFT JOIN production_recipes r ON r.id = pb.recipe_id
       WHERE pb.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; status: string; recipe_id: string; branch_id: string; planned_quantity: number; recipe_yield: number }>();

  if (!batch) return c.json(errBody("NOT_FOUND", "Lote de producción no encontrado"), 404);
  if (batch.status === "completed") {
    return c.json(errBody("CONFLICT", "No se puede cancelar un lote completado"), 409);
  }
  if (batch.status === "cancelled") {
    return c.json(errBody("CONFLICT", "El lote ya está cancelado"), 409);
  }

  const userId = c.get("userId") ?? "";
  const user = await resolveUser(c.env.DB, userId);
  if (!user) return c.json(errBody("FORBIDDEN", "Usuario no registrado"), 403);

  const userRole = c.get("userRole");
  if (userRole !== "admin" && userRole !== "owner" && userRole !== "supervisor" && userRole !== "production") {
    return c.json(errBody("FORBIDDEN", "No tienes permisos para cancelar lotes de producción"), 403);
  }

  const now = nowSqliteTs();

  if (batch.status === "in_progress") {
    // Reverse the ingredient consumption that was applied when the batch started.
    // Validamos recipe_yield > 0 — sin esto el multiplicador sería incorrecto
    // y dejaría inventarios inconsistentes tras la reversión.
    if ((batch.recipe_yield ?? 0) <= 0) {
      return c.json(errBody("VALIDATION_ERROR", "recipe_yield debe ser mayor a 0"), 400);
    }

    const ingredients = await db
      .prepare("SELECT * FROM recipe_ingredients WHERE recipe_id = ?")
      .bind(batch.recipe_id)
      .all<{ ingredient_product_id: string; quantity: number; waste_percentage: number }>();

    const batchMultiplier = batch.planned_quantity / batch.recipe_yield;

    const reverseStatements = (ingredients.results ?? []).flatMap(ing => {
      const totalQty = parseFloat((ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4));
      const movId = genId();
      return [
        db.prepare(
          `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, ?, 'production_in', ?, 'Reversión cancelación lote producción', ?, ?)`,
        ).bind(movId, ing.ingredient_product_id, batch.branch_id, totalQty, user.id, now),
        db.prepare(
          `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
           WHERE product_id = ? AND branch_id = ?`,
        ).bind(totalQty, now, ing.ingredient_product_id, batch.branch_id),
      ];
    });

    reverseStatements.push(
      db.prepare("UPDATE production_batches SET status = 'cancelled' WHERE id = ?")
        .bind(id),
    );

    if (reverseStatements.length > 100) {
      return c.json(errBody("VALIDATION_ERROR", "Receta con demasiados ingredientes para revertir en una sola operación"), 400);
    }

    await db.batch(reverseStatements);
  } else {
    await db
      .prepare("UPDATE production_batches SET status = 'cancelled' WHERE id = ?")
      .bind(id)
      .run();
  }

  return c.json({ success: true, data: { id, status: "cancelled", updated_at: now } });
});
