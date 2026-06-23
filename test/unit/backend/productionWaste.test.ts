import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para POST /batches/:id/complete — validación waste y movimiento production_waste.
 *
 * Lógica extraída del handler:
 *   1. Si actual + waste > planned * PRODUCTION_WASTE_TOLERANCE → 409 QUANTITY_EXCEEDS_PLAN.
 *   2. Si waste > 0 → INSERT stock_movements con movement_type='production_waste', quantity=-waste.
 *   3. El INSERT de waste va en el mismo db.batch() que el resto del complete.
 */

// ── Constante exportada (replica de production.ts) ───────────────────────────

export const PRODUCTION_WASTE_TOLERANCE = 1.05;

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

interface CompleteInput {
  actual_quantity: number;
  waste_quantity?: number;
  notes?: string;
}

interface Batch {
  id: string;
  branch_id: string;
  planned_quantity: number;
  output_product_id: string;
  user_id: string;
}

interface CompleteResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Lógica pura extraída de production.ts /:id/complete ─────────────────────

async function handleBatchComplete(
  db: StubDb,
  batch: Batch,
  body: CompleteInput,
  genId: () => string,
  nowTs: () => string,
  userId: string,
): Promise<CompleteResult> {
  const wasteQty = body.waste_quantity ?? 0;

  if (body.actual_quantity + wasteQty > batch.planned_quantity * PRODUCTION_WASTE_TOLERANCE) {
    return {
      status: 409,
      body: {
        success: false,
        error: {
          code: 'QUANTITY_EXCEEDS_PLAN',
          planned: batch.planned_quantity,
          actual: body.actual_quantity,
          waste: wasteQty,
        },
      },
    };
  }

  const now = nowTs();
  const movId = genId();
  const completionStatus = body.actual_quantity < batch.planned_quantity ? 'partial' : 'completed';

  const completeStatements: BoundStmt[] = [
    db.prepare(
      `UPDATE production_batches
       SET status = ?, actual_quantity = ?, waste_quantity = ?, notes = ?, completed_at = ?
       WHERE id = ?`,
    ).bind(completionStatus, body.actual_quantity, wasteQty, body.notes ?? null, now, batch.id),
    db.prepare(
      `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
       VALUES (?, ?, ?, 'production_in', ?, 'Producción completada', ?, ?)`,
    ).bind(movId, batch.output_product_id, batch.branch_id, body.actual_quantity, userId, now),
    db.prepare(
      `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
       WHERE product_id = ? AND branch_id = ?`,
    ).bind(body.actual_quantity, now, batch.output_product_id, batch.branch_id),
  ];

  if (wasteQty > 0) {
    const wasteMovId = genId();
    completeStatements.push(
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at)
         VALUES (?, ?, ?, 'production_waste', ?, 'Desperdicio lote producción', ?, ?)`,
      ).bind(wasteMovId, batch.output_product_id, batch.branch_id, -wasteQty, userId, now),
    );
  }

  await db.batch(completeStatements);

  return {
    status: 200,
    body: {
      success: true,
      data: { id: batch.id, status: completionStatus, actual_quantity: body.actual_quantity, completed_at: now },
    },
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

function makeBatch(overrides?: Partial<Batch>): Batch {
  return {
    id: 'batch_1',
    branch_id: 'branch_1',
    planned_quantity: 1000,
    output_product_id: 'producto_terminado',
    user_id: 'user_1',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PRODUCTION_WASTE_TOLERANCE', () => {
  it('es exactamente 1.05', () => {
    expect(PRODUCTION_WASTE_TOLERANCE).toBe(1.05);
  });
});

describe('POST /batches/:id/complete — validación waste y movimiento', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `id_${++counter}`;
    nowTs = () => '2024-01-01 10:00:00';
  });

  it('actual + waste <= planned * 1.05 → pasa (200)', async () => {
    const db = makeDb();
    // 900 + 100 = 1000 <= 1000 * 1.05 = 1050 → OK
    const result = await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 900, waste_quantity: 100 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  it('actual + waste en el límite exacto (= planned * 1.05) → pasa (200)', async () => {
    const db = makeDb();
    // 950 + 100 = 1050 = 1000 * 1.05 → exactamente en el borde → OK
    const result = await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 950, waste_quantity: 100 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(result.status).toBe(200);
  });

  it('actual + waste > planned * 1.05 → 409 QUANTITY_EXCEEDS_PLAN', async () => {
    const db = makeDb();
    // 900 + 200 = 1100 > 1000 * 1.05 = 1050 → error
    const result = await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 900, waste_quantity: 200 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('QUANTITY_EXCEEDS_PLAN');
    expect(err.planned).toBe(1000);
    expect(err.actual).toBe(900);
    expect(err.waste).toBe(200);
  });

  it('409 QUANTITY_EXCEEDS_PLAN no ejecuta db.batch()', async () => {
    const db = makeDb();
    await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 900, waste_quantity: 200 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(db.batchCalls).toHaveLength(0);
  });

  it('waste > 0 → batch incluye INSERT production_waste con quantity negativa', async () => {
    const db = makeDb();
    await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000, output_product_id: 'prod_A' }),
      { actual_quantity: 800, waste_quantity: 50 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    const wasteStmt = stmts.find(s => s.sql.includes("'production_waste'"));
    expect(wasteStmt).toBeDefined();
    // quantity debe ser -waste_quantity = -50
    const args = wasteStmt!.args;
    const qtyIdx = args.findIndex(a => a === -50);
    expect(qtyIdx).toBeGreaterThanOrEqual(0);
    // product_id debe ser el producto terminado (output_product_id)
    expect(args).toContain('prod_A');
  });

  it('waste > 0 → el INSERT production_waste está en el mismo batch que production_in', async () => {
    const db = makeDb();
    await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 900, waste_quantity: 30 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    const hasIn = stmts.some(s => s.sql.includes("'production_in'"));
    const hasWaste = stmts.some(s => s.sql.includes("'production_waste'"));
    expect(hasIn).toBe(true);
    expect(hasWaste).toBe(true);
  });

  it('waste === 0 → NO hay INSERT production_waste en el batch', async () => {
    const db = makeDb();
    await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 900, waste_quantity: 0 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    const hasWaste = stmts.some(s => s.sql.includes("'production_waste'"));
    expect(hasWaste).toBe(false);
  });

  it('waste omitido (undefined) → NO hay INSERT production_waste', async () => {
    const db = makeDb();
    await handleBatchComplete(
      db,
      makeBatch({ planned_quantity: 1000 }),
      { actual_quantity: 900 },
      idGen,
      nowTs,
      'user_1',
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    expect(stmts.some(s => s.sql.includes("'production_waste'"))).toBe(false);
  });
});
