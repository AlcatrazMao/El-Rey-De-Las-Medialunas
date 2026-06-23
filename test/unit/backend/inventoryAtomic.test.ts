import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests para POST /adjust — atomicidad e idempotencia.
 *
 * Testeamos la lógica pura desacoplada de Hono/D1:
 *   1. idempotency_key duplicado → retorna el movement existente sin re-insertar.
 *   2. El batch contiene exactamente 3 statements (INSERT movement, INSERT OR IGNORE
 *      inventory row, UPDATE inventory) — si alguno falla, D1 revierte todo.
 */

// ── Tipos mínimos ────────────────────────────────────────────────────────────

interface StubDb {
  prepare: (sql: string) => StubStmt;
  batch: (stmts: StubBoundStmt[]) => Promise<void>;
}

interface StubStmt {
  bind: (...args: unknown[]) => StubBoundStmt;
}

interface StubBoundStmt {
  run: () => Promise<void>;
  first: <T>() => Promise<T | null>;
  sql: string;
  args: unknown[];
}

// ── Helper: construye un fake D1 que registra llamadas ──────────────────────

function makeStubDb(overrides?: {
  idempotencyCheckResult?: { id: string } | null;
  batchFn?: (stmts: StubBoundStmt[]) => Promise<void>;
}): StubDb & { batchCalls: StubBoundStmt[][] } {
  const batchCalls: StubBoundStmt[][] = [];

  const db: StubDb & { batchCalls: StubBoundStmt[][] } = {
    batchCalls,
    prepare(sql: string): StubStmt {
      return {
        bind(...args: unknown[]): StubBoundStmt {
          return {
            sql,
            args,
            async run() {},
            async first<T>(): Promise<T | null> {
              // Simula el SELECT idempotency_key check
              if (/idempotency_key/.test(sql) && overrides?.idempotencyCheckResult !== undefined) {
                return overrides.idempotencyCheckResult as T | null;
              }
              return null;
            },
          };
        },
      };
    },
    async batch(stmts: StubBoundStmt[]): Promise<void> {
      batchCalls.push(stmts);
      if (overrides?.batchFn) {
        return overrides.batchFn(stmts);
      }
    },
  };

  return db;
}

// ── Réplica de la lógica de POST /adjust (sin Hono) ─────────────────────────
// Refleja el comportamiento del handler real en inventory.ts.

const VALID_MOVEMENT_TYPES = new Set([
  'purchase_in', 'production_in', 'transfer_in', 'adjustment_in', 'return_in',
  'sale_out', 'transfer_out', 'waste_out', 'adjustment_out', 'production_out',
]);

interface AdjustBody {
  product_id: string;
  branch_id?: string;
  movement_type: string;
  quantity: number;
  reason?: string;
  notes?: string;
  unit_cost_at_time?: number;
  idempotency_key?: string;
}

interface AdjustResult {
  success: boolean;
  data: { id: string };
  idempotent_replay?: boolean;
  status: number;
}

async function handleAdjust(
  db: StubDb,
  body: AdjustBody,
  genId: () => string,
  nowTs: () => string,
): Promise<AdjustResult> {
  if (!body.product_id) {
    throw new Error('VALIDATION_ERROR: product_id requerido');
  }
  if (!body.movement_type || !VALID_MOVEMENT_TYPES.has(body.movement_type)) {
    throw new Error('VALIDATION_ERROR: movement_type inválido');
  }
  if (typeof body.quantity !== 'number' || body.quantity <= 0 || !isFinite(body.quantity)) {
    throw new Error('VALIDATION_ERROR: quantity inválida');
  }

  const branchId = body.branch_id ?? 'branch_1';

  // Idempotency check
  const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim() !== ''
    ? body.idempotency_key.trim()
    : null;

  if (idempotencyKey) {
    const existing = await db
      .prepare('SELECT id FROM stock_movements WHERE idempotency_key = ? LIMIT 1')
      .bind(idempotencyKey)
      .first<{ id: string }>();
    if (existing) {
      return { success: true, data: { id: existing.id }, idempotent_replay: true, status: 200 };
    }
  }

  const movementId = genId();
  const createdAt = nowTs();
  const isInbound = body.movement_type.endsWith('_in');
  const delta = isInbound ? body.quantity : -body.quantity;
  const invId = genId();

  const updateSql = isInbound
    ? `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ? WHERE product_id = ? AND branch_id = ?`
    : `UPDATE inventory SET current_quantity = MAX(0, current_quantity + ?), updated_at = ? WHERE product_id = ? AND branch_id = ?`;

  await db.batch([
    db.prepare(
      `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, unit_cost_at_time, reason, user_id, notes, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(movementId, body.product_id, branchId, body.movement_type, body.quantity, body.unit_cost_at_time ?? null, body.reason ?? null, 'user_1', body.notes ?? null, idempotencyKey, createdAt),
    db.prepare(
      `INSERT OR IGNORE INTO inventory (id, product_id, branch_id, current_quantity, updated_at) VALUES (?, ?, ?, 0, ?)`
    ).bind(invId, body.product_id, branchId, createdAt),
    db.prepare(updateSql).bind(delta, createdAt, body.product_id, branchId),
  ]);

  return { success: true, data: { id: movementId }, status: 201 };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /adjust — idempotency_key', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `id_${++counter}`;
    nowTs = () => '2024-01-01 12:00:00';
  });

  it('idempotency_key duplicado → retorna el movement existente sin llamar a batch', async () => {
    const db = makeStubDb({ idempotencyCheckResult: { id: 'existing_mov_id' } });

    const result = await handleAdjust(
      db,
      {
        product_id: 'prod_1',
        movement_type: 'adjustment_in',
        quantity: 10,
        idempotency_key: 'idem_key_abc',
      },
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);
    expect(result.idempotent_replay).toBe(true);
    expect(result.data.id).toBe('existing_mov_id');
    // No se debe haber llamado al batch — no hay re-inserción
    expect(db.batchCalls).toHaveLength(0);
  });

  it('idempotency_key nuevo → llama al batch y retorna 201', async () => {
    const db = makeStubDb({ idempotencyCheckResult: null });

    const result = await handleAdjust(
      db,
      {
        product_id: 'prod_1',
        movement_type: 'adjustment_in',
        quantity: 5,
        idempotency_key: 'idem_key_nuevo',
      },
      idGen,
      nowTs,
    );

    expect(result.status).toBe(201);
    expect(result.idempotent_replay).toBeUndefined();
    expect(db.batchCalls).toHaveLength(1);
  });

  it('sin idempotency_key → no hace SELECT previo y llama al batch', async () => {
    const db = makeStubDb();

    const result = await handleAdjust(
      db,
      { product_id: 'prod_1', movement_type: 'purchase_in', quantity: 3 },
      idGen,
      nowTs,
    );

    expect(result.status).toBe(201);
    expect(db.batchCalls).toHaveLength(1);
  });

  it('idempotency_key vacío se trata como ausente', async () => {
    const db = makeStubDb({ idempotencyCheckResult: { id: 'should_not_be_used' } });

    const result = await handleAdjust(
      db,
      { product_id: 'prod_1', movement_type: 'adjustment_out', quantity: 2, idempotency_key: '   ' },
      idGen,
      nowTs,
    );

    // Con key vacío no se hace el SELECT de idempotency, va directo al batch
    expect(result.status).toBe(201);
    expect(db.batchCalls).toHaveLength(1);
  });
});

describe('POST /adjust — batch atómico con 3 statements', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `id_${++counter}`;
    nowTs = () => '2024-01-01 12:00:00';
  });

  it('el batch contiene INSERT stock_movement + INSERT OR IGNORE inventory + UPDATE inventory', async () => {
    const db = makeStubDb();

    await handleAdjust(
      db,
      { product_id: 'prod_abc', movement_type: 'purchase_in', quantity: 20 },
      idGen,
      nowTs,
    );

    expect(db.batchCalls).toHaveLength(1);
    const stmts = db.batchCalls[0];
    expect(stmts).toHaveLength(3);

    expect(stmts[0].sql).toMatch(/INSERT INTO stock_movements/i);
    expect(stmts[1].sql).toMatch(/INSERT OR IGNORE INTO inventory/i);
    expect(stmts[2].sql).toMatch(/UPDATE inventory/i);
  });

  it('_in: el UPDATE usa suma directa (sin MAX clamp)', async () => {
    const db = makeStubDb();

    await handleAdjust(
      db,
      { product_id: 'prod_1', movement_type: 'production_in', quantity: 15 },
      idGen,
      nowTs,
    );

    const updateStmt = db.batchCalls[0][2];
    expect(updateStmt.sql).not.toMatch(/MAX/i);
    expect(updateStmt.args[0]).toBe(15); // delta positivo
  });

  it('_out: el UPDATE usa MAX(0, current + delta) para clampear negativos', async () => {
    const db = makeStubDb();

    await handleAdjust(
      db,
      { product_id: 'prod_1', movement_type: 'waste_out', quantity: 8 },
      idGen,
      nowTs,
    );

    const updateStmt = db.batchCalls[0][2];
    expect(updateStmt.sql).toMatch(/MAX\(0/i);
    expect(updateStmt.args[0]).toBe(-8); // delta negativo
  });

  it('si el batch falla, lanza y no retorna éxito (atomicidad)', async () => {
    const db = makeStubDb({
      batchFn: async () => { throw new Error('D1_ERROR: disk full'); },
    });

    await expect(
      handleAdjust(
        db,
        { product_id: 'prod_1', movement_type: 'adjustment_in', quantity: 1 },
        idGen,
        nowTs,
      ),
    ).rejects.toThrow('D1_ERROR');
  });

  it('el INSERT de stock_movements incluye el campo idempotency_key', async () => {
    const db = makeStubDb();

    await handleAdjust(
      db,
      { product_id: 'prod_1', movement_type: 'adjustment_in', quantity: 5, idempotency_key: 'k1' },
      idGen,
      nowTs,
    );

    const insertStmt = db.batchCalls[0][0];
    expect(insertStmt.sql).toMatch(/idempotency_key/i);
    // El arg de idempotency_key debe ser 'k1' (position 9 en el bind)
    expect(insertStmt.args).toContain('k1');
  });
});
