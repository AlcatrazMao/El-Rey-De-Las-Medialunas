import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para POST /batches/expire-stale — LIMIT 100 + stock_movements.
 *
 * Testeamos la lógica pura desacoplada de Hono/D1:
 *   1. El SELECT de lotes a expirar usa LIMIT 100.
 *   2. Se emiten stock_movements de tipo 'expired_out' por cada lote con remaining_quantity > 0.
 *   3. La quantity del movement = remaining_quantity del lote.
 *   4. Se actualiza inventory descontando la remaining_quantity.
 *   5. Lotes con remaining_quantity = 0 no generan movement ni UPDATE inventory.
 *   6. Si no hay lotes → retorna expired_count: 0 sin llamar a batch.
 */

// ── Tipos mínimos ─────────────────────────────────────────────────────────────

interface StaleRow {
  id: string;
  product_id: string;
  branch_id: string;
  remaining_quantity: number;
}

interface StubBoundStmt {
  sql: string;
  args: unknown[];
  run: () => Promise<void>;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
}

interface StubStmt {
  bind: (...args: unknown[]) => StubBoundStmt;
}

interface StubDb {
  prepare: (sql: string) => StubStmt;
  batch: (stmts: StubBoundStmt[]) => Promise<void>;
  batchCalls: StubBoundStmt[][];
  selectSqlCalls: string[];
}

// ── Helper: construye un fake D1 ──────────────────────────────────────────────

function makeStubDb(staleRows: StaleRow[]): StubDb {
  const batchCalls: StubBoundStmt[][] = [];
  const selectSqlCalls: string[] = [];

  return {
    batchCalls,
    selectSqlCalls,
    prepare(sql: string): StubStmt {
      return {
        bind(...args: unknown[]): StubBoundStmt {
          return {
            sql,
            args,
            async run(): Promise<void> {},
            async first<T>(): Promise<T | null> { return null; },
            async all<T>(): Promise<{ results: T[] }> {
              selectSqlCalls.push(sql);
              return { results: staleRows as unknown as T[] };
            },
          };
        },
      };
    },
    async batch(stmts: StubBoundStmt[]): Promise<void> {
      batchCalls.push(stmts);
    },
  };
}

// ── Réplica de la lógica POST /expire-stale (sin Hono/D1 reales) ─────────────

interface ExpireStaleResult {
  success: boolean;
  data: { expired_count: number };
}

async function handleExpireStale(
  db: StubDb,
  userId: string,
  genId: () => string,
  nowTs: () => string,
): Promise<ExpireStaleResult> {
  const now = nowTs();

  const staleRows = await db
    .prepare(
      `SELECT id, product_id, branch_id, remaining_quantity
         FROM inventory_batches
        WHERE status = 'active'
          AND expiry_date IS NOT NULL
          AND expiry_date < DATE('now', '-3 hours')
        LIMIT 100`,
    )
    .bind()
    .all<StaleRow>();

  const batches = staleRows.results ?? [];
  if (batches.length === 0) {
    return { success: true, data: { expired_count: 0 } };
  }

  const ids = batches.map((b) => b.id);
  const placeholders = ids.map(() => '?').join(',');

  const stmts: StubBoundStmt[] = [
    db
      .prepare(`UPDATE inventory_batches SET status = 'expired' WHERE id IN (${placeholders})`)
      .bind(...ids),
  ];

  for (const b of batches) {
    if (b.remaining_quantity <= 0) continue;

    const movId = genId();
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, branch_id, batch_id, movement_type, quantity, reason, user_id, created_at)
           VALUES (?, ?, ?, ?, 'expired_out', ?, 'Lote expirado — baja automática', ?, ?)`,
        )
        .bind(movId, b.product_id, b.branch_id, b.id, b.remaining_quantity, userId, now),
    );

    stmts.push(
      db
        .prepare(
          `UPDATE inventory
              SET current_quantity = MAX(0, current_quantity - ?), updated_at = ?
            WHERE product_id = ? AND branch_id = ?`,
        )
        .bind(b.remaining_quantity, now, b.product_id, b.branch_id),
    );
  }

  await db.batch(stmts);

  return { success: true, data: { expired_count: batches.length } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /batches/expire-stale — SELECT usa LIMIT 100', () => {
  it('el SQL del SELECT incluye LIMIT 100', async () => {
    const db = makeStubDb([]);
    await handleExpireStale(db, 'user_1', () => 'mov_1', () => '2025-01-15 12:00:00');

    expect(db.selectSqlCalls).toHaveLength(1);
    expect(db.selectSqlCalls[0]).toMatch(/LIMIT\s+100/i);
  });

  it('cuando no hay lotes vencidos, retorna expired_count: 0 sin llamar a batch', async () => {
    const db = makeStubDb([]);
    const result = await handleExpireStale(db, 'user_1', () => 'mov_1', () => '2025-01-15 12:00:00');

    expect(result.data.expired_count).toBe(0);
    expect(db.batchCalls).toHaveLength(0);
  });
});

describe('POST /batches/expire-stale — stock_movements de tipo expired_out', () => {
  let idCounter: number;
  let genId: () => string;
  const NOW = '2025-01-15 12:00:00';

  beforeEach(() => {
    idCounter = 0;
    genId = () => `mov_${++idCounter}`;
  });

  it('emite un stock_movement de tipo expired_out por cada lote con remaining_quantity > 0', async () => {
    const staleRows: StaleRow[] = [
      { id: 'batch_1', product_id: 'prod_1', branch_id: 'branch_1', remaining_quantity: 10 },
      { id: 'batch_2', product_id: 'prod_2', branch_id: 'branch_1', remaining_quantity: 5 },
    ];
    const db = makeStubDb(staleRows);

    await handleExpireStale(db, 'user_1', genId, () => NOW);

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];

    // Estructura esperada: 1 UPDATE batches + 2 * (INSERT movement + UPDATE inventory)
    // = 1 + 2*2 = 5 statements
    expect(stmts).toHaveLength(5);

    const movements = stmts.filter((s) => /INSERT INTO stock_movements/i.test(s.sql));
    expect(movements).toHaveLength(2);
    for (const mov of movements) {
      expect(mov.sql).toMatch(/expired_out/i);
    }
  });

  it('la quantity del movement coincide con remaining_quantity del lote', async () => {
    const staleRows: StaleRow[] = [
      { id: 'batch_qty', product_id: 'prod_1', branch_id: 'branch_1', remaining_quantity: 37 },
    ];
    const db = makeStubDb(staleRows);

    await handleExpireStale(db, 'user_1', genId, () => NOW);

    const stmts = db.batchCalls[0];
    const movStmt = stmts.find((s) => /INSERT INTO stock_movements/i.test(s.sql));
    expect(movStmt).toBeDefined();
    // remaining_quantity = 37 debe estar entre los args del INSERT
    expect(movStmt!.args).toContain(37);
  });

  it('lotes con remaining_quantity = 0 no generan movement ni UPDATE inventory', async () => {
    const staleRows: StaleRow[] = [
      { id: 'batch_zero', product_id: 'prod_1', branch_id: 'branch_1', remaining_quantity: 0 },
      { id: 'batch_nonzero', product_id: 'prod_2', branch_id: 'branch_1', remaining_quantity: 15 },
    ];
    const db = makeStubDb(staleRows);

    await handleExpireStale(db, 'user_1', genId, () => NOW);

    const stmts = db.batchCalls[0];
    // 1 UPDATE batches + 1 INSERT movement + 1 UPDATE inventory (solo el lote con qty > 0)
    expect(stmts).toHaveLength(3);

    const movements = stmts.filter((s) => /INSERT INTO stock_movements/i.test(s.sql));
    expect(movements).toHaveLength(1);
    expect(movements[0].args).toContain(15);
  });

  it('el UPDATE inventory usa MAX(0, current_quantity - ?) para no quedar negativo', async () => {
    const staleRows: StaleRow[] = [
      { id: 'batch_inv', product_id: 'prod_1', branch_id: 'branch_1', remaining_quantity: 20 },
    ];
    const db = makeStubDb(staleRows);

    await handleExpireStale(db, 'user_1', genId, () => NOW);

    const stmts = db.batchCalls[0];
    // Match UPDATE inventory (the stock table) but NOT UPDATE inventory_batches
    const invUpdate = stmts.find(
      (s) => /UPDATE inventory\b/i.test(s.sql) && !/inventory_batches/i.test(s.sql),
    );
    expect(invUpdate).toBeDefined();
    expect(invUpdate!.sql).toMatch(/MAX\(0/i);
    expect(invUpdate!.args).toContain(20);
  });

  it('el primer statement del batch es el UPDATE de inventory_batches a status expired', async () => {
    const staleRows: StaleRow[] = [
      { id: 'batch_a', product_id: 'prod_1', branch_id: 'branch_1', remaining_quantity: 5 },
    ];
    const db = makeStubDb(staleRows);

    await handleExpireStale(db, 'user_1', genId, () => NOW);

    const firstStmt = db.batchCalls[0][0];
    expect(firstStmt.sql).toMatch(/UPDATE inventory_batches.*expired/i);
    expect(firstStmt.args).toContain('batch_a');
  });

  it('expired_count coincide con la cantidad de lotes procesados', async () => {
    const staleRows: StaleRow[] = [
      { id: 'b1', product_id: 'p1', branch_id: 'br1', remaining_quantity: 3 },
      { id: 'b2', product_id: 'p2', branch_id: 'br1', remaining_quantity: 7 },
      { id: 'b3', product_id: 'p3', branch_id: 'br1', remaining_quantity: 0 },
    ];
    const db = makeStubDb(staleRows);

    const result = await handleExpireStale(db, 'user_1', genId, () => NOW);

    // expired_count = 3 (todos los seleccionados, independientemente de qty)
    expect(result.data.expired_count).toBe(3);
  });
});
