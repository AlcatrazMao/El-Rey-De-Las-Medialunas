import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para POST /orders/:id/receive — optimistic UPDATE guard contra concurrencia.
 *
 * Lógica extraída del handler:
 *   1. Por cada item consolidado se ejecuta un UPDATE optimista con la condición
 *      `AND received_quantity + ? <= quantity` integrada en el SQL.
 *   2. Si meta.changes === 0 en cualquier UPDATE → overshoot detectado → 409 OVERSHOOT_GUARD.
 *   3. Solo si todos los UPDATEs tienen changes > 0 → se ejecuta el batch de
 *      stock_movements + UPDATE inventory + UPDATE purchase_orders.
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

interface ConsolidatedItem {
  productId: string;
  received_quantity: number;
  unit_cost?: number | null;
}

interface OrderItem {
  product_id: string;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
}

interface ReceiveResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Lógica pura extraída de purchases.ts /orders/:id/receive ────────────────

async function handleReceive(
  db: StubDb,
  orderId: string,
  branchId: string,
  consolidatedItems: ConsolidatedItem[],
  orderItemsByProduct: Map<string, OrderItem>,
  genId: () => string,
  nowTs: () => string,
): Promise<ReceiveResult> {
  const now = nowTs();

  const itemEntries = consolidatedItems.filter(
    item => item.productId && item.received_quantity > 0,
  );

  // Phase 1: optimistic UPDATEs with the overshoot condition baked in
  const optimisticUpdateStatements = itemEntries.map(item =>
    db.prepare(
      `UPDATE purchase_order_items
       SET received_quantity = received_quantity + ?
       WHERE purchase_order_id = ? AND product_id = ? AND received_quantity + ? <= quantity`,
    ).bind(item.received_quantity, orderId, item.productId, item.received_quantity),
  );

  const optimisticResults = await db.batch(optimisticUpdateStatements);

  for (let i = 0; i < itemEntries.length; i++) {
    if ((optimisticResults[i]?.meta?.changes ?? 0) === 0) {
      const item = itemEntries[i];
      return {
        status: 409,
        body: {
          success: false,
          error: {
            code: 'OVERSHOOT_GUARD',
            product_id: item.productId,
          },
        },
      };
    }
  }

  // Phase 2: side-effect batch (stock movements + inventory + order status)
  const sideEffectStatements = itemEntries.flatMap(item => {
    const movementId = genId();
    const orderRow = orderItemsByProduct.get(item.productId);
    const unitCostAtTime = item.unit_cost !== undefined && item.unit_cost !== null
      ? Number(item.unit_cost)
      : (orderRow ? orderRow.unit_cost : null);
    return [
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, unit_cost_at_time, reason, user_id, created_at)
         VALUES (?, ?, ?, 'purchase_in', ?, ?, 'Recepción OC ' || ?, ?, ?)`,
      ).bind(movementId, item.productId, branchId, item.received_quantity, unitCostAtTime, orderId, 'user_1', now),
      db.prepare(
        `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ?
         WHERE product_id = ? AND branch_id = ?`,
      ).bind(item.received_quantity, now, item.productId, branchId),
    ];
  });

  // Simulate order status computation
  const allReceived = itemEntries.every(item => {
    const orderRow = orderItemsByProduct.get(item.productId);
    if (!orderRow) return false;
    return orderRow.received_quantity + item.received_quantity >= orderRow.quantity;
  });
  const newStatus = allReceived ? 'received' : 'partially_received';

  sideEffectStatements.push(
    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, now, orderId),
  );

  if (sideEffectStatements.length > 0) await db.batch(sideEffectStatements);

  return {
    status: 200,
    body: { success: true, data: { id: orderId, status: newStatus, received_at: now } },
  };
}

// ── Helper: construye stub DB ────────────────────────────────────────────────

function makeDb(opts: {
  // changes retornados por la fase optimista, uno por item en orden
  optimisticChanges: number[];
}): StubDb & { batchCalls: BoundStmt[][] } {
  const batchCalls: BoundStmt[][] = [];
  let optimisticBatchIndex = 0;

  const db: StubDb & { batchCalls: BoundStmt[][] } = {
    batchCalls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]): BoundStmt {
          return {
            sql,
            args,
            async run() { return { meta: { changes: 1 } }; },
            async first<T>(): Promise<T | null> { return null; },
          };
        },
      };
    },
    async batch(stmts: BoundStmt[]): Promise<Array<{ meta: { changes: number } }>> {
      batchCalls.push(stmts);

      // First batch call = optimistic UPDATEs; return the configured changes.
      if (optimisticBatchIndex === 0) {
        optimisticBatchIndex++;
        return stmts.map((_, i) => ({
          meta: { changes: opts.optimisticChanges[i] ?? 1 },
        }));
      }

      // Subsequent batch calls = side-effect writes; always succeed.
      optimisticBatchIndex++;
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };

  return db;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /orders/:id/receive — optimistic UPDATE guard', () => {
  let idGen: () => string;
  let nowTs: () => string;

  beforeEach(() => {
    let counter = 0;
    idGen = () => `mov_${++counter}`;
    nowTs = () => '2024-06-01 09:00:00';
  });

  it('UPDATE optimista con changes=1 → continúa con el batch de stock movements', async () => {
    const db = makeDb({ optimisticChanges: [1] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 0, unit_cost: 100 }],
    ]);

    const result = await handleReceive(
      db,
      'order_1',
      'branch_1',
      [{ productId: 'prod_A', received_quantity: 5 }],
      orderItems,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    // Debe haber dos batch calls: optimistic + side-effects
    expect(db.batchCalls).toHaveLength(2);
  });

  it('UPDATE optimista con changes=0 → retorna 409 OVERSHOOT_GUARD, no ejecuta side-effects', async () => {
    const db = makeDb({ optimisticChanges: [0] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 8, unit_cost: 100 }],
    ]);

    const result = await handleReceive(
      db,
      'order_1',
      'branch_1',
      // Intenta recibir 5, pero la OC ya tiene 8 de 10 → el guard SQL lo bloquea
      [{ productId: 'prod_A', received_quantity: 5 }],
      orderItems,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('OVERSHOOT_GUARD');
    expect(err.product_id).toBe('prod_A');
    // Solo el batch optimista debe haberse ejecutado
    expect(db.batchCalls).toHaveLength(1);
  });

  it('múltiples items: el segundo falla (changes=0) → 409 OVERSHOOT_GUARD con product correcto', async () => {
    const db = makeDb({ optimisticChanges: [1, 0] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 0, unit_cost: 50 }],
      ['prod_B', { product_id: 'prod_B', quantity: 5, received_quantity: 4, unit_cost: 80 }],
    ]);

    const result = await handleReceive(
      db,
      'order_1',
      'branch_1',
      [
        { productId: 'prod_A', received_quantity: 3 },
        { productId: 'prod_B', received_quantity: 3 }, // 4 + 3 = 7 > 5 → guard lo bloquea
      ],
      orderItems,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(409);
    const err = result.body.error as Record<string, unknown>;
    expect(err.code).toBe('OVERSHOOT_GUARD');
    expect(err.product_id).toBe('prod_B');
    expect(db.batchCalls).toHaveLength(1);
  });

  it('la condición SQL del UPDATE optimista incluye received_quantity + ? <= quantity', async () => {
    const db = makeDb({ optimisticChanges: [1] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 0, unit_cost: 100 }],
    ]);

    await handleReceive(
      db,
      'order_1',
      'branch_1',
      [{ productId: 'prod_A', received_quantity: 5 }],
      orderItems,
      idGen,
      nowTs,
    );

    // Verificar que el batch optimista usa la condición correcta
    const optimisticBatch = db.batchCalls[0];
    expect(optimisticBatch).toHaveLength(1);
    const stmt = optimisticBatch[0];
    expect(stmt.sql).toMatch(/received_quantity\s*\+\s*\?\s*<=\s*quantity/i);
    // Los args deben incluir: [received_qty, orderId, productId, received_qty (para la condición)]
    expect(stmt.args[0]).toBe(5);   // SET received_quantity = received_quantity + ?
    expect(stmt.args[3]).toBe(5);   // AND received_quantity + ? <= quantity
  });

  it('recepción exitosa de todos los items → orden pasa a estado received', async () => {
    const db = makeDb({ optimisticChanges: [1] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 0, unit_cost: 100 }],
    ]);

    const result = await handleReceive(
      db,
      'order_1',
      'branch_1',
      [{ productId: 'prod_A', received_quantity: 10 }],
      orderItems,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);
    const data = result.body.data as Record<string, unknown>;
    expect(data.status).toBe('received');
  });

  it('recepción parcial → orden pasa a estado partially_received', async () => {
    const db = makeDb({ optimisticChanges: [1] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 0, unit_cost: 100 }],
    ]);

    const result = await handleReceive(
      db,
      'order_1',
      'branch_1',
      [{ productId: 'prod_A', received_quantity: 5 }],
      orderItems,
      idGen,
      nowTs,
    );

    expect(result.status).toBe(200);
    const data = result.body.data as Record<string, unknown>;
    expect(data.status).toBe('partially_received');
  });

  it('el batch de side-effects incluye INSERT stock_movement + UPDATE inventory + UPDATE order', async () => {
    const db = makeDb({ optimisticChanges: [1] });

    const orderItems = new Map([
      ['prod_A', { product_id: 'prod_A', quantity: 10, received_quantity: 0, unit_cost: 100 }],
    ]);

    await handleReceive(
      db,
      'order_1',
      'branch_1',
      [{ productId: 'prod_A', received_quantity: 5 }],
      orderItems,
      idGen,
      nowTs,
    );

    expect(db.batchCalls).toHaveLength(2);
    const sideEffects = db.batchCalls[1];
    // 2 stmts por item (INSERT stock_movement + UPDATE inventory) + 1 UPDATE order = 3
    expect(sideEffects).toHaveLength(3);
    expect(sideEffects[0].sql).toMatch(/INSERT INTO stock_movements/i);
    expect(sideEffects[1].sql).toMatch(/UPDATE inventory/i);
    expect(sideEffects[2].sql).toMatch(/UPDATE purchase_orders/i);
  });
});
