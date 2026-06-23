import { describe, it, expect } from 'vitest';

/**
 * Tests para:
 *   1. POST /products/:id/prices — atomicidad via db.batch([deactivate, insert])
 *   2. GET /products — branch_id override para roles sin privilegios cross-branch
 *
 * Toda la lógica se extrae/replica como funciones puras sin dependencia de Hono/D1.
 */

// ── Tipos mínimos ─────────────────────────────────────────────────────────────

interface BoundStmt {
  sql: string;
  args: unknown[];
}

interface StubDb {
  prepare: (sql: string) => { bind: (...args: unknown[]) => BoundStmt };
  batch: (stmts: BoundStmt[]) => Promise<Array<{ meta: { changes: number } }>>;
  batchCalls: BoundStmt[][];
}

// ── Helper: stub DB que registra llamadas a batch ────────────────────────────

function makeDb(): StubDb {
  const batchCalls: BoundStmt[][] = [];

  const db: StubDb = {
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

  return db;
}

// ── Lógica pura: POST /:id/prices con batch atómico ─────────────────────────

const DEFAULT_BRANCH_ID = 'branch_default';

async function handlePostPrice(
  db: StubDb,
  productId: string,
  body: {
    price_list_type: 'retail' | 'wholesale' | 'promotional';
    price: number;
    branch_id?: string;
    start_date?: string;
    end_date?: string;
  },
  genId: () => string,
  nowTs: () => string,
): Promise<{ status: number; batchCallCount: number; firstBatchLength: number }> {
  const branchId = body.branch_id ?? DEFAULT_BRANCH_ID;
  const id = genId();
  const now = nowTs();

  const deactivate = db.prepare(
    'UPDATE product_prices SET is_active = 0 WHERE product_id = ? AND price_list_type = ? AND is_active = 1',
  ).bind(productId, body.price_list_type);

  const insert = db.prepare(
    `INSERT INTO product_prices
      (id, product_id, branch_id, price_list_type, price, start_date, end_date, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(
    id,
    productId,
    branchId,
    body.price_list_type,
    body.price,
    body.start_date ?? null,
    body.end_date ?? null,
    now,
    now,
  );

  await db.batch([deactivate, insert]);

  return {
    status: 201,
    batchCallCount: (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls.length,
    firstBatchLength: (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0]?.length ?? 0,
  };
}

// ── Lógica pura: branch_id override para GET /products ───────────────────────

function resolveProductsBranchId(params: {
  role: string | undefined;
  queryParamBranchId: string | undefined;
  jwtBranchId: string | undefined;
}): string {
  const { role, queryParamBranchId, jwtBranchId } = params;
  if (role === 'admin' || role === 'owner') {
    return queryParamBranchId ?? jwtBranchId ?? DEFAULT_BRANCH_ID;
  }
  // Para cualquier otro rol: ignorar query param, usar branch del token
  return jwtBranchId ?? DEFAULT_BRANCH_ID;
}

// ── Tests: precios atómicos ───────────────────────────────────────────────────

describe('POST /products/:id/prices — batch atómico deactivate + insert', () => {
  let idCounter = 0;
  const genId = () => `price_${++idCounter}`;
  const nowTs = () => '2026-06-22 10:00:00';

  it('se ejecuta exactamente un batch (no dos queries separadas)', async () => {
    const db = makeDb();
    const result = await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100 },
      genId,
      nowTs,
    );
    expect(result.batchCallCount).toBe(1);
  });

  it('el batch contiene exactamente 2 statements: deactivate + insert', async () => {
    const db = makeDb();
    const result = await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'wholesale', price: 80 },
      genId,
      nowTs,
    );
    expect(result.firstBatchLength).toBe(2);
  });

  it('el primer statement del batch es el UPDATE de deactivate', async () => {
    const db = makeDb();
    await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100 },
      genId,
      nowTs,
    );
    const batchStmts = (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0];
    expect(batchStmts[0].sql).toMatch(/UPDATE product_prices/i);
    expect(batchStmts[0].sql).toMatch(/is_active\s*=\s*0/i);
  });

  it('el segundo statement del batch es el INSERT del nuevo precio', async () => {
    const db = makeDb();
    await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100 },
      genId,
      nowTs,
    );
    const batchStmts = (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0];
    expect(batchStmts[1].sql).toMatch(/INSERT INTO product_prices/i);
    // is_active está listada como columna y su valor es el literal 1 en VALUES
    expect(batchStmts[1].sql).toContain('is_active');
    // El INSERT hardcodea is_active = 1 (valor fijo, no placeholder)
    expect(batchStmts[1].sql).toMatch(/VALUES\s*\([^)]*,\s*1\s*,/i);
  });

  it('el deactivate filtra por product_id y price_list_type correctos', async () => {
    const db = makeDb();
    await handlePostPrice(
      db,
      'prod_ABC',
      { price_list_type: 'promotional', price: 50 },
      genId,
      nowTs,
    );
    const batchStmts = (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0];
    const deactivateArgs = batchStmts[0].args;
    expect(deactivateArgs[0]).toBe('prod_ABC');
    expect(deactivateArgs[1]).toBe('promotional');
  });

  it('el INSERT usa el branch_id del body si se provee', async () => {
    const db = makeDb();
    await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100, branch_id: 'branch_norte' },
      genId,
      nowTs,
    );
    const batchStmts = (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0];
    const insertArgs = batchStmts[1].args;
    // Args: id, productId, branchId, price_list_type, price, start_date, end_date, now, now
    expect(insertArgs[2]).toBe('branch_norte');
  });

  it('el INSERT usa DEFAULT_BRANCH_ID si no se provee branch_id', async () => {
    const db = makeDb();
    await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100 },
      genId,
      nowTs,
    );
    const batchStmts = (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0];
    const insertArgs = batchStmts[1].args;
    expect(insertArgs[2]).toBe(DEFAULT_BRANCH_ID);
  });

  it('el INSERT incluye created_at y updated_at no nulos', async () => {
    const db = makeDb();
    await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100 },
      genId,
      nowTs,
    );
    const batchStmts = (db as StubDb & { batchCalls: BoundStmt[][] }).batchCalls[0];
    const insertArgs = batchStmts[1].args;
    // Posiciones: 0=id, 1=productId, 2=branchId, 3=type, 4=price,
    //             5=start_date, 6=end_date, 7=created_at, 8=updated_at
    expect(insertArgs[7]).toBe('2026-06-22 10:00:00');
    expect(insertArgs[8]).toBe('2026-06-22 10:00:00');
  });

  it('retorna status 201', async () => {
    const db = makeDb();
    const result = await handlePostPrice(
      db,
      'prod_1',
      { price_list_type: 'retail', price: 100 },
      genId,
      nowTs,
    );
    expect(result.status).toBe(201);
  });
});

// ── Tests: branch_id override en GET /products ───────────────────────────────

describe('GET /products — branch_id override para roles sin privilegios', () => {
  const JWT_BRANCH = 'branch_jwt';
  const QUERY_BRANCH = 'branch_otra_sucursal';

  it('cashier ignora query param → usa branch del JWT', () => {
    const branch = resolveProductsBranchId({
      role: 'cashier',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(JWT_BRANCH);
    expect(branch).not.toBe(QUERY_BRANCH);
  });

  it('production ignora query param → usa branch del JWT', () => {
    const branch = resolveProductsBranchId({
      role: 'production',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(JWT_BRANCH);
  });

  it('warehouse ignora query param → usa branch del JWT', () => {
    const branch = resolveProductsBranchId({
      role: 'warehouse',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(JWT_BRANCH);
  });

  it('supervisor ignora query param → usa branch del JWT', () => {
    const branch = resolveProductsBranchId({
      role: 'supervisor',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(JWT_BRANCH);
  });

  it('admin puede usar el query param → usa branch_otra_sucursal', () => {
    const branch = resolveProductsBranchId({
      role: 'admin',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(QUERY_BRANCH);
  });

  it('owner puede usar el query param → usa branch_otra_sucursal', () => {
    const branch = resolveProductsBranchId({
      role: 'owner',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(QUERY_BRANCH);
  });

  it('admin sin query param → usa branch del JWT', () => {
    const branch = resolveProductsBranchId({
      role: 'admin',
      queryParamBranchId: undefined,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(JWT_BRANCH);
  });

  it('cashier sin branch en JWT → fallback a DEFAULT_BRANCH_ID', () => {
    const branch = resolveProductsBranchId({
      role: 'cashier',
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: undefined,
    });
    expect(branch).toBe(DEFAULT_BRANCH_ID);
    expect(branch).not.toBe(QUERY_BRANCH);
  });

  it('admin sin query param ni JWT branch → fallback a DEFAULT_BRANCH_ID', () => {
    const branch = resolveProductsBranchId({
      role: 'admin',
      queryParamBranchId: undefined,
      jwtBranchId: undefined,
    });
    expect(branch).toBe(DEFAULT_BRANCH_ID);
  });

  it('rol undefined → no es admin ni owner → usa branch del JWT', () => {
    const branch = resolveProductsBranchId({
      role: undefined,
      queryParamBranchId: QUERY_BRANCH,
      jwtBranchId: JWT_BRANCH,
    });
    expect(branch).toBe(JWT_BRANCH);
    expect(branch).not.toBe(QUERY_BRANCH);
  });
});
