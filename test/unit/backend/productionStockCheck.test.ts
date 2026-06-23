import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para POST /batches/:id/start — pre-flight stock check y race-condition guard.
 *
 * Lógica extraída del handler:
 *   1. Para cada ingrediente se calcula totalQty = qty * multiplier * (1 + waste/100).
 *   2. Se hace SELECT current_quantity de inventory. Si available < totalQty → 409 INSUFFICIENT_STOCK.
 *   3. Si todos pasan, se hace db.batch() con pares [INSERT stock_movement, UPDATE inventory WHERE current_quantity >= ?].
 *   4. Se verifica meta.changes de cada UPDATE. Si changes === 0 → 409 RACE_CONDITION.
 */

// ── Tipos mínimos ────────────────────────────────────────────────────────────

interface BoundStmt {
  sql: string;
  args: unknown[];
  run: () => Promise<{ meta: { changes: number } }>;
  first: <T>() => Promise<T | null>;
}

interface StubDb {
  prepare: (sql: string) => { bind: (...args: unknown[]) => BoundStmt };
  batch: (stmts: BoundStmt[]) => Promise<Array<{ meta: { changes: number } }>>;
  batchCalls: BoundStmt[][];
}

// ── Tipos del dominio ────────────────────────────────────────────────────────

interface Ingredient {
  ingredient_product_id: string;
  quantity: number;
  waste_percentage: number;
}

interface StockRow {
  current_quantity: number;
}

interface StartResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Lógica pura extraída de production.ts /:id/start ────────────────────────

async function handleBatchStart(
  db: StubDb,
  batchId: string,
  recipeId: string,
  branchId: string,
  plannedQuantity: number,
  recipeYield: number,
  ingredients: Ingredient[],
  genId: () => string,
  nowTs: () => string,
): Promise<StartResult> {
  const batchMultiplier = plannedQuantity / recipeYield;
  const now = nowTs();

  // Pre-flight stock check
  for (const ing of ingredients) {
    const totalQty = parseFloat(
      (ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4),
    );
    const stockRow = await db
      .prepare('SELECT current_quantity FROM inventory WHERE product_id = ? AND branch_id = ? LIMIT 1')
      .bind(ing.ingredient_product_id, branchId)
      .first<StockRow>();
    const available = stockRow ? Number(stockRow.current_quantity) : 0;
    if (available < totalQty) {
      return {
        status: 409,
        body: {
          success: false,
          error: {
            code: 'INSUFFICIENT_STOCK',
            ingredient_id: ing.ingredient_product_id,
            required: totalQty,
            available,
          },
        },
      };
    }
  }

  // Build optimistic batch
  const consumeStatements = ingredients.flatMap(ing => {
    const totalQty = parseFloat(
      (ing.quantity * batchMultiplier * (1 + ing.waste_percentage / 100)).toFixed(4),
    );
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
    db.prepare("UPDATE production_batches SET status = 'in_progress', started_at = ? WHERE id = ?")
      .bind(now, batchId),
  );

  const batchResults = await db.batch(consumeStatements);

  for (let i = 0; i < ingredients.length; i++) {
    const updateResult = batchResults[i * 2 + 1];
    if ((updateResult?.meta?.changes ?? 0) === 0) {
      return {
        status: 409,
        body: {
          success: false,
          error: {
            code: 'RACE_CONDITION',
            ingredient_id: ingredients[i].ingredient_product_id,
          },
        },
      };
    }
  }

  return {
    status: 200,
    body: { success: true, data: { id: batchId, status: 'in_progress', started_at: now } },
  };
}

// ── Helper: construye stub DB con stock configurable ─────────────────────────

function makeDb(opts: {
  stockByProductId: Record<string, number>;
  // changes para el resultado del batch por índice (0 = primer UPDATE de inventario)
  batchUpdateChanges?: number[];
}): StubDb & { batchCalls: BoundStmt[][] } {
  const batchCalls: BoundStmt[][] = [];

  const db: StubDb & { batchCalls: BoundStmt[][] } = {
    batchCalls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]): BoundStmt {
          return {
            sql,
            args,
            async run() { return { meta: { changes: 1 } }; },
            async first<T>(): Promise<T | null> {
              if (/SELECT current_quantity FROM inventory/.test(sql)) {
                const productId = args[0] as string;
                const qty = opts.stockByProductId[productId];
                if (qty === undefined) return null;
                return { current_quantity: qty } as unknown as T;
              }
              return null;
            },
          };
        },
      };
    },
    async batch(stmts: BoundStmt[]): Promise<Array<{ meta: { changes: number } }>> {
      batchCalls.push(stmts);
      // Simulate batch results: INSERTs always succeed (changes=1),
      // UPDATEs on inventory use the configured batchUpdateChanges by their position.
      const changesList = opts.batchUpdateChanges ?? [];
      let updateIdx = 0;
      return stmts.map(stmt => {
        if (/UPDATE inventory/.test(stmt.sql)) {
          const changes = changesList[updateIdx] ?? 1;
          updateIdx++;
          return { meta: { changes } };
        }
        return { meta: { changes: 1 } };
      });
    },
  };

  return db;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /batches/:id/start — stock check', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `id_${++counter}`;
    nowTs = () => '2024-01-01 10:00:00';
  });

  it('stock suficiente para todos los ingredientes → pasa y retorna in_progress', async () => {
    const db = makeDb({
      stockByProductId: { harina: 100, agua: 50 },
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,   // planned_quantity
      10,   // recipe_yield → multiplier = 1
      [
        { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
        { ingredient_product_id: 'agua', quantity: 2, waste_percentage: 0 },
      ],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect((result.body.data as Record<string, unknown>).status).toBe('in_progress');
    // Se debe haber llamado al batch
    expect(db.batchCalls).toHaveLength(1);
  });

  it('stock insuficiente en primer ingrediente → 409 INSUFFICIENT_STOCK con ingredient_id correcto', async () => {
    const db = makeDb({
      // harina tiene solo 3 unidades pero necesitamos 5
      stockByProductId: { harina: 3, agua: 50 },
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [
        { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
        { ingredient_product_id: 'agua', quantity: 2, waste_percentage: 0 },
      ],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.ingredient_id).toBe('harina');
    expect(err.required).toBe(5);
    expect(err.available).toBe(3);
    // No se llama al batch si falla el pre-flight
    expect(db.batchCalls).toHaveLength(0);
  });

  it('stock insuficiente en segundo ingrediente → 409 INSUFFICIENT_STOCK con ingredient_id del segundo', async () => {
    const db = makeDb({
      stockByProductId: { harina: 100, agua: 1 },
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [
        { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
        { ingredient_product_id: 'agua', quantity: 2, waste_percentage: 0 },
      ],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.ingredient_id).toBe('agua');
    expect(db.batchCalls).toHaveLength(0);
  });

  it('waste_percentage incrementa la cantidad requerida', async () => {
    const db = makeDb({
      // Con 5 qty y 10% waste necesitamos 5.5 — damos 5 → insuficiente
      stockByProductId: { harina: 5 },
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [{ ingredient_product_id: 'harina', quantity: 5, waste_percentage: 10 }],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.required).toBe(5.5);
    expect(err.available).toBe(5);
  });

  it('race condition: UPDATE inventory con changes=0 → 409 RACE_CONDITION', async () => {
    const db = makeDb({
      stockByProductId: { harina: 100 },
      // El UPDATE de inventory devuelve changes=0 (otro request se adelantó)
      batchUpdateChanges: [0],
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [{ ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 }],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('RACE_CONDITION');
    expect(err.ingredient_id).toBe('harina');
    // El batch SÍ se ejecutó (llegamos al optimistic UPDATE)
    expect(db.batchCalls).toHaveLength(1);
  });

  it('race condition en segundo ingrediente → 409 RACE_CONDITION con ingredient correcto', async () => {
    const db = makeDb({
      stockByProductId: { harina: 100, agua: 50 },
      // El primer UPDATE pasa (changes=1), el segundo falla (changes=0)
      batchUpdateChanges: [1, 0],
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [
        { ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 },
        { ingredient_product_id: 'agua', quantity: 2, waste_percentage: 0 },
      ],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('RACE_CONDITION');
    expect(err.ingredient_id).toBe('agua');
  });

  it('el UPDATE de inventory usa WHERE current_quantity >= ? (sin MAX(0,...))', async () => {
    const db = makeDb({
      stockByProductId: { harina: 100 },
      batchUpdateChanges: [1],
    });

    await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [{ ingredient_product_id: 'harina', quantity: 5, waste_percentage: 0 }],
      idGen,
      nowTs,
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    // El UPDATE de inventory es el segundo statement (índice 1)
    const updateStmt = stmts[1];
    expect(updateStmt.sql).toMatch(/current_quantity\s*-\s*\?/i);
    expect(updateStmt.sql).toMatch(/AND current_quantity >= \?/i);
    expect(updateStmt.sql).not.toMatch(/MAX\(0/i);
  });

  it('ingrediente sin fila en inventory (null) → available=0 → 409 INSUFFICIENT_STOCK', async () => {
    const db = makeDb({
      // stockByProductId no tiene entrada para "sal" → devuelve null
      stockByProductId: {},
    });

    const result = await handleBatchStart(
      db,
      'batch_1',
      'recipe_1',
      'branch_1',
      10,
      10,
      [{ ingredient_product_id: 'sal', quantity: 1, waste_percentage: 0 }],
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.available).toBe(0);
  });
});
