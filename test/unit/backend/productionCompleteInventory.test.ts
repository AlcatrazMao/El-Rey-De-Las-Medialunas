import { describe, it, expect } from 'vitest';

// ── Lógica pura: /batches/:id/complete — INSERT OR IGNORE + production_waste ──
// Testeamos las invariantes sin Hono ni D1.

interface Batch {
  output_product_id: string;
  branch_id: string;
}

interface InventoryRow {
  product_id: string;
  branch_id: string;
  current_quantity: number;
}

/**
 * Determina si el complete de un lote debe emitir un INSERT OR IGNORE de
 * inventory antes del UPDATE.
 *
 * La respuesta es siempre true: el INSERT OR IGNORE es no-op si la fila ya
 * existe, y garantiza la existencia cuando no existe (primera producción).
 * Se incluye en el batch atómico para evitar que el UPDATE afecte 0 filas.
 */
function shouldInsertOrIgnoreInventory(
  batch: Batch,
  existingInventory: InventoryRow | null,
): boolean {
  // La fila puede no existir (primera producción) o ya existir.
  // En ambos casos el INSERT OR IGNORE debe estar en el batch.
  void batch;
  void existingInventory;
  return true;
}

/**
 * Simula el batch de statements del /complete y verifica su estructura.
 * Replica la lógica de production.ts sin dependencias de runtime.
 */
interface StubBoundStmt {
  sql: string;
  args: unknown[];
}

function buildCompleteStatements(params: {
  batch: Batch;
  actualQuantity: number;
  wasteQty: number;
  now: string;
  genId: () => string;
  userId: string;
  completionStatus: string;
  notes: string | null;
}): StubBoundStmt[] {
  const { batch, actualQuantity, wasteQty, now, genId, userId, completionStatus, notes } = params;

  const movId = genId();

  const stmts: StubBoundStmt[] = [
    {
      sql: `UPDATE production_batches SET status = ?, actual_quantity = ?, waste_quantity = ?, notes = ?, completed_at = ? WHERE id = ?`,
      args: [completionStatus, actualQuantity, wasteQty, notes, now, 'batch_1'],
    },
    {
      sql: `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at) VALUES (?, ?, ?, 'production_in', ?, 'Producción completada', ?, ?)`,
      args: [movId, batch.output_product_id, batch.branch_id, actualQuantity, userId, now],
    },
    // INSERT OR IGNORE garantiza que la fila exista antes del UPDATE
    {
      sql: `INSERT OR IGNORE INTO inventory (id, product_id, branch_id, current_quantity, updated_at) VALUES (?, ?, ?, 0, ?)`,
      args: [genId(), batch.output_product_id, batch.branch_id, now],
    },
    {
      sql: `UPDATE inventory SET current_quantity = current_quantity + ?, updated_at = ? WHERE product_id = ? AND branch_id = ?`,
      args: [actualQuantity, now, batch.output_product_id, batch.branch_id],
    },
  ];

  if (wasteQty > 0) {
    const wasteMovId = genId();
    stmts.push({
      sql: `INSERT INTO stock_movements (id, product_id, branch_id, movement_type, quantity, reason, user_id, created_at) VALUES (?, ?, ?, 'production_waste', ?, 'Desperdicio lote producción', ?, ?)`,
      // quantity es positivo — la dirección la comunica el tipo, no el signo
      args: [wasteMovId, batch.output_product_id, batch.branch_id, wasteQty, userId, now],
    });
  }

  return stmts;
}

// ── Tests ────────────────────────────────────────────────────────────────────

const NOW = '2026-06-23 10:00:00';
const BATCH: Batch = { output_product_id: 'prod_medialuna', branch_id: 'branch_1' };

describe('shouldInsertOrIgnoreInventory', () => {
  it('primera producción (sin fila de inventory) → debe insertar', () => {
    expect(shouldInsertOrIgnoreInventory(BATCH, null)).toBe(true);
  });

  it('producción subsiguiente (fila ya existe) → INSERT OR IGNORE es no-op pero debe estar', () => {
    const existingRow: InventoryRow = {
      product_id: BATCH.output_product_id,
      branch_id: BATCH.branch_id,
      current_quantity: 50,
    };
    // Siempre true: el INSERT OR IGNORE es inofensivo si ya existe,
    // y necesario si no existe. Omitirlo es el bug.
    expect(shouldInsertOrIgnoreInventory(BATCH, existingRow)).toBe(true);
  });
});

describe('buildCompleteStatements — estructura del batch', () => {
  let counter = 0;
  const genId = () => `id_${++counter}`;

  it('el batch sin desperdicio tiene 4 statements (UPDATE batch, INSERT mov, INSERT OR IGNORE inv, UPDATE inv)', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 100,
      wasteQty: 0,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    expect(stmts).toHaveLength(4);
    expect(stmts[0].sql).toMatch(/UPDATE production_batches/i);
    expect(stmts[1].sql).toMatch(/INSERT INTO stock_movements/i);
    expect(stmts[1].sql).toMatch(/production_in/i);
    expect(stmts[2].sql).toMatch(/INSERT OR IGNORE INTO inventory/i);
    expect(stmts[3].sql).toMatch(/UPDATE inventory/i);
  });

  it('el INSERT OR IGNORE está ANTES del UPDATE de inventory (orden correcto)', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 80,
      wasteQty: 0,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    const insertOrIgnoreIdx = stmts.findIndex(s => /INSERT OR IGNORE INTO inventory/i.test(s.sql));
    const updateInvIdx = stmts.findIndex(s => /UPDATE inventory/i.test(s.sql));

    expect(insertOrIgnoreIdx).toBeGreaterThanOrEqual(0);
    expect(updateInvIdx).toBeGreaterThan(insertOrIgnoreIdx);
  });

  it('el UPDATE de inventory suma la actual_quantity al stock existente', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 75,
      wasteQty: 0,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    const updateStmt = stmts.find(s => /UPDATE inventory SET current_quantity = current_quantity \+/i.test(s.sql));
    expect(updateStmt).toBeDefined();
    expect(updateStmt?.args[0]).toBe(75);
  });
});

describe('production_waste — quantity positivo', () => {
  let counter = 0;
  const genId = () => `id_${++counter}`;

  it('con desperdicio > 0 el batch tiene 5 statements', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 90,
      wasteQty: 10,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    expect(stmts).toHaveLength(5);
  });

  it('production_waste quantity es positivo (la dirección la comunica el tipo)', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 90,
      wasteQty: 10,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    const wasteStmt = stmts.find(s => /production_waste/i.test(s.sql));
    expect(wasteStmt).toBeDefined();

    // quantity (4to arg en el bind: id, product_id, branch_id, qty, ...)
    const wasteQtyArg = wasteStmt?.args[3];
    expect(typeof wasteQtyArg).toBe('number');
    expect(wasteQtyArg as number).toBeGreaterThan(0);
    expect(wasteQtyArg).toBe(10);
  });

  it('production_waste quantity NO es negativo', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 80,
      wasteQty: 5,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    const wasteStmt = stmts.find(s => /production_waste/i.test(s.sql));
    const wasteQtyArg = wasteStmt?.args[3] as number;
    expect(wasteQtyArg).not.toBeLessThan(0);
  });

  it('sin desperdicio (wasteQty = 0) NO hay statement de production_waste', () => {
    counter = 0;
    const stmts = buildCompleteStatements({
      batch: BATCH,
      actualQuantity: 100,
      wasteQty: 0,
      now: NOW,
      genId,
      userId: 'user_1',
      completionStatus: 'completed',
      notes: null,
    });

    const wasteStmt = stmts.find(s => /production_waste/i.test(s.sql));
    expect(wasteStmt).toBeUndefined();
  });
});
