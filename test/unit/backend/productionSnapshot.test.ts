import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para el snapshot de ingredientes consumidos en /start y su uso en /cancel.
 *
 * Lógica extraída de production.ts:
 *   /start: calcula consumed_quantity por ingrediente, serializa como JSON en consumed_snapshot
 *           y lo persiste en el UPDATE de production_batches dentro del db.batch().
 *   /cancel (con snapshot): lee consumed_snapshot del batch y revierte esas cantidades exactas.
 *   /cancel (sin snapshot): recalcula desde la receta actual (fallback para batches pre-fix).
 */

// ── Tipos mínimos ────────────────────────────────────────────────────────────

interface BoundStmt {
  sql: string;
  args: unknown[];
}

interface StubDb {
  prepare: (sql: string) => { bind: (...args: unknown[]) => BoundStmt };
  batch: (stmts: BoundStmt[]) => Promise<Array<{ meta: { changes: number } }>>;
  batchCalls: BoundStmt[][];
}

interface Ingredient {
  ingredient_product_id: string;
  quantity: number;
  waste_percentage: number;
}

interface SnapshotEntry {
  ingredient_product_id: string;
  consumed_quantity: number;
}

interface StartResult {
  status: number;
  snapshot: SnapshotEntry[] | null;
  batchCalls: BoundStmt[][];
}

interface CancelResult {
  status: number;
  body: Record<string, unknown>;
  batchCalls: BoundStmt[][];
}

// ── Lógica pura extraída de production.ts /:id/start (solo snapshot) ─────────

async function handleBatchStart(
  db: StubDb,
  batchId: string,
  branchId: string,
  plannedQuantity: number,
  recipeYield: number,
  ingredients: Ingredient[],
  genId: () => string,
  nowTs: () => string,
): Promise<StartResult> {
  const batchMultiplier = plannedQuantity / recipeYield;
  const now = nowTs();

  const consumedSnapshot: SnapshotEntry[] = [];

  const consumeStatements: BoundStmt[] = ingredients.flatMap(ing => {
    const totalQty = parseFloat(
      (ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4),
    );
    consumedSnapshot.push({ ingredient_product_id: ing.ingredient_product_id, consumed_quantity: totalQty });
    const movId = genId();
    return [
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'production_out', ?, 'Consumo lote producción', ?, ?)`,
      ).bind(movId, ing.ingredient_product_id, branchId, totalQty, 'user_1', now),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity - ?, updated_at = ?
         WHERE product_id = ? AND branch_id = ? AND current_quantity >= ?`,
      ).bind(totalQty, now, ing.ingredient_product_id, branchId, totalQty),
    ];
  });

  consumeStatements.push(
    db.prepare(
      "UPDATE production_batches SET consumed_snapshot = ?, status = 'in_progress', started_at = ? WHERE id = ?",
    ).bind(JSON.stringify(consumedSnapshot), now, batchId),
  );

  await db.batch(consumeStatements);

  return {
    status: 200,
    snapshot: consumedSnapshot,
    batchCalls: db.batchCalls,
  };
}

// ── Lógica pura extraída de production.ts /:id/cancel ────────────────────────

async function handleBatchCancel(
  db: StubDb,
  batchId: string,
  branchId: string,
  recipeId: string,
  plannedQuantity: number,
  recipeYield: number,
  consumedSnapshotJson: string | null,
  currentIngredients: Ingredient[],   // simula lo que devuelve SELECT recipe_ingredients
  genId: () => string,
  nowTs: () => string,
): Promise<CancelResult> {
  const now = nowTs();
  const userId = 'user_1';

  let ingredientsToRevert: SnapshotEntry[] | null = null;

  if (consumedSnapshotJson) {
    try {
      ingredientsToRevert = JSON.parse(consumedSnapshotJson) as SnapshotEntry[];
    } catch {
      ingredientsToRevert = null;
    }
  }

  if (!ingredientsToRevert) {
    // Fallback: recalcular desde la receta actual
    if ((recipeYield ?? 0) <= 0) {
      return {
        status: 400,
        body: { success: false, error: { code: 'VALIDATION_ERROR' } },
        batchCalls: db.batchCalls,
      };
    }

    const batchMultiplier = plannedQuantity / recipeYield;
    ingredientsToRevert = currentIngredients.map(ing => ({
      ingredient_product_id: ing.ingredient_product_id,
      consumed_quantity: parseFloat(
        (ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4),
      ),
    }));
  }

  const reverseStatements: BoundStmt[] = ingredientsToRevert.flatMap(ing => {
    const totalQty = ing.consumed_quantity;
    const movId = genId();
    return [
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'production_in', ?, 'Reversión cancelación lote producción', ?, ?)`,
      ).bind(movId, ing.ingredient_product_id, branchId, totalQty, userId, now),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
         WHERE product_id = ? AND branch_id = ?`,
      ).bind(totalQty, now, ing.ingredient_product_id, branchId),
    ];
  });

  reverseStatements.push(
    db.prepare("UPDATE production_batches SET status = 'cancelled' WHERE id = ?").bind(batchId),
  );

  await db.batch(reverseStatements);

  return {
    status: 200,
    body: { success: true, data: { id: batchId, status: 'cancelled', updated_at: now } },
    batchCalls: db.batchCalls,
  };
}

// ── Helper: stub DB ──────────────────────────────────────────────────────────

function makeDb(): StubDb & { batchCalls: BoundStmt[][] } {
  const batchCalls: BoundStmt[][] = [];
  return {
    batchCalls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]): BoundStmt {
          return { sql, args };
        },
      };
    },
    async batch(stmts: BoundStmt[]): Promise<Array<{ meta: { changes: number } }>> {
      batchCalls.push(stmts);
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /batches/:id/start — serialización del snapshot', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `id_${++counter}`;
    nowTs = () => '2024-01-01 10:00:00';
  });

  it('snapshot contiene ingredient_product_id y consumed_quantity correctos', async () => {
    const db = makeDb();
    // planned=20, yield=10 → multiplier=2; harina: 5*2*(1+0/100)=10, agua: 2*2*(1+10/100)=4.4
    const result = await handleBatchStart(
      db,
      'batch_1',
      'branch_1',
      20,
      10,
      [
        { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
        { ingredient_product_id: 'agua', quantity: 2, waste_percentage: 10 },
      ],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);
    expect(result.snapshot).toHaveLength(2);
    expect(result.snapshot![0]).toEqual({ ingredient_product_id: 'harina', consumed_quantity: 10 });
    expect(result.snapshot![1]).toEqual({ ingredient_product_id: 'agua', consumed_quantity: 4.4 });
  });

  it('el UPDATE de production_batches incluye consumed_snapshot serializado como JSON', async () => {
    const db = makeDb();
    const result = await handleBatchStart(
      db,
      'batch_1',
      'branch_1',
      10,
      10,
      [{ ingredient_product_id: 'sal', quantity: 1, waste_percentage: 0 }],
      idGen,
      nowTs,
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    const updateStmt = stmts.find(s => s.sql.includes('UPDATE production_batches'));
    expect(updateStmt).toBeDefined();
    // El primer arg es el JSON del snapshot
    const snapshotJson = updateStmt!.args[0] as string;
    const parsed = JSON.parse(snapshotJson) as SnapshotEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ingredient_product_id).toBe('sal');
    expect(parsed[0].consumed_quantity).toBe(1);
  });

  it('snapshot se incluye en el mismo db.batch() que los movimientos', async () => {
    const db = makeDb();
    await handleBatchStart(
      db,
      'batch_1',
      'branch_1',
      10,
      10,
      [{ ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 }],
      idGen,
      nowTs,
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    const hasMovement = stmts.some(s => s.sql.includes("'production_out'"));
    const hasUpdate = stmts.some(s => s.sql.includes('UPDATE production_batches'));
    expect(hasMovement).toBe(true);
    expect(hasUpdate).toBe(true);
  });
});

describe('POST /batches/:id/cancel — uso del snapshot', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `id_${++counter}`;
    nowTs = () => '2024-01-01 10:00:00';
  });

  it('con snapshot → usa cantidades del snapshot, no de la receta actual', async () => {
    const db = makeDb();

    // El snapshot dice que se consumieron 10 unidades de harina
    const snapshot: SnapshotEntry[] = [
      { ingredient_product_id: 'harina', consumed_quantity: 10 },
    ];

    // La receta actual (modificada) diría 5 unidades — pero el cancel debe ignorarla
    const currentIngredients: Ingredient[] = [
      { ingredient_product_id: 'harina', quantity: 2.5, waste_percentage: 0 },
    ];

    const result = await handleBatchCancel(
      db,
      'batch_1',
      'branch_1',
      'recipe_1',
      10,     // planned_quantity
      10,     // recipe_yield (da multiplier=1, pero no se usará)
      JSON.stringify(snapshot),
      currentIngredients,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);

    // El UPDATE de inventory debe usar la cantidad del snapshot (10), no de la receta (5)
    const stmts = db.batchCalls[0];
    const inventoryUpdate = stmts.find(s => s.sql.includes('UPDATE inventory') && s.sql.includes('current_quantity + ?'));
    expect(inventoryUpdate).toBeDefined();
    expect(inventoryUpdate!.args[0]).toBe(10);
  });

  it('con snapshot → el movimiento de reversión usa la cantidad exacta del snapshot', async () => {
    const db = makeDb();

    const snapshot: SnapshotEntry[] = [
      { ingredient_product_id: 'azucar', consumed_quantity: 7.5 },
    ];

    await handleBatchCancel(
      db,
      'batch_1',
      'branch_1',
      'recipe_1',
      10,
      10,
      JSON.stringify(snapshot),
      [],
      idGen,
      nowTs,
    );

    const stmts = db.batchCalls[0];
    const movStmt = stmts.find(s => s.sql.includes("'production_in'"));
    expect(movStmt).toBeDefined();
    // quantity en el INSERT debe ser 7.5 (del snapshot)
    expect(movStmt!.args).toContain(7.5);
  });

  it('sin snapshot → usa fallback con receta actual', async () => {
    const db = makeDb();

    // Sin snapshot — la receta actual dice 5 * multiplier (1) = 5
    const currentIngredients: Ingredient[] = [
      { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
    ];

    const result = await handleBatchCancel(
      db,
      'batch_1',
      'branch_1',
      'recipe_1',
      10,
      10,   // yield=10, planned=10 → multiplier=1 → qty=5
      null,
      currentIngredients,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);

    const stmts = db.batchCalls[0];
    const inventoryUpdate = stmts.find(s => s.sql.includes('UPDATE inventory') && s.sql.includes('current_quantity + ?'));
    expect(inventoryUpdate).toBeDefined();
    expect(inventoryUpdate!.args[0]).toBe(5);
  });

  it('sin snapshot, multiplier != 1 → el fallback escala correctamente', async () => {
    const db = makeDb();

    // planned=20, yield=10 → multiplier=2; harina: 3*2=6
    const currentIngredients: Ingredient[] = [
      { ingredient_product_id: 'harina', quantity: 3, waste_percentage: 0 },
    ];

    await handleBatchCancel(
      db,
      'batch_1',
      'branch_1',
      'recipe_1',
      20,
      10,
      null,
      currentIngredients,
      idGen,
      nowTs,
    );

    const stmts = db.batchCalls[0];
    const inventoryUpdate = stmts.find(s => s.sql.includes('UPDATE inventory') && s.sql.includes('current_quantity + ?'));
    expect(inventoryUpdate!.args[0]).toBe(6);
  });

  it('JSON corrupto en consumed_snapshot → cae al fallback de receta actual', async () => {
    const db = makeDb();

    const currentIngredients: Ingredient[] = [
      { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
    ];

    const result = await handleBatchCancel(
      db,
      'batch_1',
      'branch_1',
      'recipe_1',
      10,
      10,
      '{invalid_json',          // JSON corrupto
      currentIngredients,
      idGen,
      nowTs,
    );

    // No debe explotar — debe usar el fallback
    expect(result.status).toBe(200);
    const stmts = db.batchCalls[0];
    const inventoryUpdate = stmts.find(s => s.sql.includes('UPDATE inventory') && s.sql.includes('current_quantity + ?'));
    expect(inventoryUpdate!.args[0]).toBe(5);
  });
});
