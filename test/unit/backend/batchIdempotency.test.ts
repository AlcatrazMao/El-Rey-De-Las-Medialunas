import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para POST /batches — idempotency_key guard.
 *
 * Testeamos la lógica pura desacoplada de Hono/D1:
 *   1. idempotency_key nuevo → INSERT exitoso, status 201.
 *   2. idempotency_key existente → retorna idempotent_replay sin insertar.
 *   3. sin idempotency_key → INSERT normal sin SELECT previo.
 */

// ── Tipos mínimos ─────────────────────────────────────────────────────────────

interface BatchRow {
  id: string;
  product_id: string;
  branch_id: string;
  batch_number: string;
  entry_date: string;
  expiry_date: string | null;
  durability_days: number | null;
  cost_per_unit: number;
  initial_quantity: number;
  remaining_quantity: number;
  inventory_method: string;
  status: string;
  supplier_id: string | null;
  notes: string | null;
  idempotency_key: string | null;
  created_at: string;
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

interface StubDb {
  prepare: (sql: string) => StubStmt;
  insertCalls: Array<{ sql: string; args: unknown[] }>;
  selectCalls: Array<{ sql: string; args: unknown[] }>;
}

// ── Helper: construye un fake D1 ──────────────────────────────────────────────

function makeStubDb(overrides?: {
  existingBatch?: BatchRow | null;
}): StubDb {
  const insertCalls: Array<{ sql: string; args: unknown[] }> = [];
  const selectCalls: Array<{ sql: string; args: unknown[] }> = [];

  return {
    insertCalls,
    selectCalls,
    prepare(sql: string): StubStmt {
      return {
        bind(...args: unknown[]): StubBoundStmt {
          return {
            sql,
            args,
            async run(): Promise<void> {
              if (/INSERT/i.test(sql)) {
                insertCalls.push({ sql, args });
              }
            },
            async first<T>(): Promise<T | null> {
              if (/SELECT.*inventory_batches.*idempotency_key/i.test(sql) ||
                  /idempotency_key.*inventory_batches/i.test(sql) ||
                  (/inventory_batches/i.test(sql) && /idempotency_key/i.test(sql))) {
                selectCalls.push({ sql, args });
                return (overrides?.existingBatch ?? null) as T | null;
              }
              return null;
            },
          };
        },
      };
    },
  };
}

// ── Réplica de la lógica POST /batches (sin Hono/D1 reales) ──────────────────

interface CreateBatchBody {
  product_id: string;
  branch_id?: string;
  batch_number: string;
  entry_date: string;
  expiry_date?: string;
  durability_days?: number;
  cost_per_unit: number;
  initial_quantity: number;
  remaining_quantity?: number;
  inventory_method?: string;
  supplier_id?: string;
  notes?: string;
  idempotency_key?: string;
}

interface CreateBatchResult {
  success: boolean;
  idempotent_replay?: boolean;
  data: { id: string } | BatchRow;
  status: number;
}

async function handleCreateBatch(
  db: StubDb,
  body: CreateBatchBody,
  genId: () => string,
): Promise<CreateBatchResult> {
  const idempotencyKey =
    typeof body.idempotency_key === 'string' && body.idempotency_key.trim() !== ''
      ? body.idempotency_key.trim()
      : null;

  if (idempotencyKey) {
    const existing = await db
      .prepare('SELECT * FROM inventory_batches WHERE idempotency_key = ? LIMIT 1')
      .bind(idempotencyKey)
      .first<BatchRow>();
    if (existing) {
      return { success: true, idempotent_replay: true, data: existing, status: 200 };
    }
  }

  const id = genId();
  const remaining = body.remaining_quantity ?? body.initial_quantity;
  const branchId = body.branch_id ?? 'branch_1';
  const inventoryMethod = body.inventory_method ?? 'FIFO';

  await db
    .prepare(
      `INSERT INTO inventory_batches
        (id, product_id, branch_id, batch_number, entry_date, expiry_date, durability_days,
         cost_per_unit, initial_quantity, remaining_quantity, inventory_method, status,
         supplier_id, notes, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id,
      body.product_id,
      branchId,
      body.batch_number,
      body.entry_date,
      body.expiry_date ?? null,
      body.durability_days ?? null,
      body.cost_per_unit,
      body.initial_quantity,
      remaining,
      inventoryMethod,
      body.supplier_id ?? null,
      body.notes ?? null,
      idempotencyKey,
    )
    .run();

  return { success: true, data: { id }, status: 201 };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const BASE_BODY: CreateBatchBody = {
  product_id: 'prod_1',
  batch_number: 'LOTE-001',
  entry_date: '2025-01-15',
  cost_per_unit: 100,
  initial_quantity: 50,
};

describe('POST /batches — idempotency_key nuevo', () => {
  let idGen: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `batch_id_${++counter}`;
  });

  it('inserta el lote y retorna 201', async () => {
    const db = makeStubDb({ existingBatch: null });
    const result = await handleCreateBatch(
      db,
      { ...BASE_BODY, idempotency_key: 'idem_nuevo_001' },
      idGen,
    );

    expect(result.status).toBe(201);
    expect(result.success).toBe(true);
    expect(result.idempotent_replay).toBeUndefined();
    expect(db.insertCalls).toHaveLength(1);
  });

  it('el INSERT incluye el campo idempotency_key', async () => {
    const db = makeStubDb({ existingBatch: null });
    await handleCreateBatch(
      db,
      { ...BASE_BODY, idempotency_key: 'idem_key_xyz' },
      idGen,
    );

    const insertStmt = db.insertCalls[0];
    expect(insertStmt.sql).toMatch(/idempotency_key/i);
    expect(insertStmt.args).toContain('idem_key_xyz');
  });

  it('hace SELECT de idempotency_key antes del INSERT', async () => {
    const db = makeStubDb({ existingBatch: null });
    await handleCreateBatch(
      db,
      { ...BASE_BODY, idempotency_key: 'idem_check_001' },
      idGen,
    );

    expect(db.selectCalls).toHaveLength(1);
    expect(db.selectCalls[0].args).toContain('idem_check_001');
  });
});

describe('POST /batches — idempotency_key existente (replay)', () => {
  let idGen: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `batch_id_${++counter}`;
  });

  it('retorna idempotent_replay: true sin insertar', async () => {
    const existingBatch: BatchRow = {
      id: 'existing_batch_id',
      product_id: 'prod_1',
      branch_id: 'branch_1',
      batch_number: 'LOTE-001',
      entry_date: '2025-01-10',
      expiry_date: null,
      durability_days: null,
      cost_per_unit: 100,
      initial_quantity: 50,
      remaining_quantity: 50,
      inventory_method: 'FIFO',
      status: 'active',
      supplier_id: null,
      notes: null,
      idempotency_key: 'idem_existente_001',
      created_at: '2025-01-10 08:00:00',
    };

    const db = makeStubDb({ existingBatch });
    const result = await handleCreateBatch(
      db,
      { ...BASE_BODY, idempotency_key: 'idem_existente_001' },
      idGen,
    );

    expect(result.status).toBe(200);
    expect(result.idempotent_replay).toBe(true);
    expect(result.success).toBe(true);
  });

  it('retorna el batch existente como data (no un ID nuevo)', async () => {
    const existingBatch: BatchRow = {
      id: 'existing_batch_id_42',
      product_id: 'prod_1',
      branch_id: 'branch_1',
      batch_number: 'LOTE-002',
      entry_date: '2025-01-10',
      expiry_date: '2025-03-01',
      durability_days: 50,
      cost_per_unit: 200,
      initial_quantity: 100,
      remaining_quantity: 80,
      inventory_method: 'FIFO',
      status: 'active',
      supplier_id: null,
      notes: null,
      idempotency_key: 'idem_existente_002',
      created_at: '2025-01-10 09:00:00',
    };

    const db = makeStubDb({ existingBatch });
    const result = await handleCreateBatch(
      db,
      { ...BASE_BODY, idempotency_key: 'idem_existente_002' },
      idGen,
    );

    expect((result.data as BatchRow).id).toBe('existing_batch_id_42');
    expect((result.data as BatchRow).remaining_quantity).toBe(80);
  });

  it('no llama a INSERT cuando el lote ya existe', async () => {
    const existingBatch: BatchRow = {
      id: 'dup_batch',
      product_id: 'prod_1',
      branch_id: 'branch_1',
      batch_number: 'LOTE-001',
      entry_date: '2025-01-10',
      expiry_date: null,
      durability_days: null,
      cost_per_unit: 100,
      initial_quantity: 50,
      remaining_quantity: 50,
      inventory_method: 'FIFO',
      status: 'active',
      supplier_id: null,
      notes: null,
      idempotency_key: 'idem_dup',
      created_at: '2025-01-10 08:00:00',
    };

    const db = makeStubDb({ existingBatch });
    await handleCreateBatch(db, { ...BASE_BODY, idempotency_key: 'idem_dup' }, idGen);

    // Ningún INSERT debe haberse ejecutado — el inventario no se duplica.
    expect(db.insertCalls).toHaveLength(0);
  });
});

describe('POST /batches — sin idempotency_key', () => {
  let idGen: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `batch_id_${++counter}`;
  });

  it('INSERT normal sin SELECT previo de idempotency', async () => {
    const db = makeStubDb();
    const result = await handleCreateBatch(db, BASE_BODY, idGen);

    expect(result.status).toBe(201);
    expect(result.idempotent_replay).toBeUndefined();
    // No se hace SELECT de idempotency_key cuando no hay key
    expect(db.selectCalls).toHaveLength(0);
    expect(db.insertCalls).toHaveLength(1);
  });

  it('idempotency_key vacío (solo espacios) se trata como ausente', async () => {
    const db = makeStubDb({ existingBatch: { id: 'should_not_be_used' } as BatchRow });
    const result = await handleCreateBatch(
      db,
      { ...BASE_BODY, idempotency_key: '   ' },
      idGen,
    );

    // Key vacía → no hace SELECT → va directo al INSERT
    expect(result.status).toBe(201);
    expect(db.selectCalls).toHaveLength(0);
    expect(db.insertCalls).toHaveLength(1);
  });

  it('el INSERT incluye idempotency_key = null cuando no se provee key', async () => {
    const db = makeStubDb();
    await handleCreateBatch(db, BASE_BODY, idGen);

    const insertStmt = db.insertCalls[0];
    // El último arg del bind es el idempotency_key — debe ser null
    const lastArg = insertStmt.args[insertStmt.args.length - 1];
    expect(lastArg).toBeNull();
  });
});
