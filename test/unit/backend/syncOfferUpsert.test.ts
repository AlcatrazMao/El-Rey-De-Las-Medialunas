import { describe, expect, it, vi } from 'vitest';

// Simula la lógica de upsert de offer en sync.ts case "offer" / "update".
// La función real llama a db.prepare().bind().run(); aquí usamos fakes para
// verificar el flujo de decisión sin levantar D1.

interface RunResult {
  meta: { changes: number };
}

interface FakeDb {
  preparedStatements: { sql: string; bindings: unknown[] }[];
  updateChanges: number;
}

function makeDb(updateChanges: number): FakeDb & {
  prepare: (sql: string) => { bind: (...args: unknown[]) => { run: () => Promise<RunResult> } };
} {
  const db: FakeDb = { preparedStatements: [], updateChanges };

  return {
    ...db,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          db.preparedStatements.push({ sql, bindings });
          return {
            async run(): Promise<RunResult> {
              // El primer prepare es siempre el UPDATE; los siguientes son INSERT.
              const isUpdate = sql.trim().startsWith('UPDATE');
              return { meta: { changes: isUpdate ? db.updateChanges : 1 } };
            },
          };
        },
      };
    },
  };
}

// Réplica de la lógica de upsert extraída de applyOperation / case "offer" update.
async function applyOfferUpdate(
  db: ReturnType<typeof makeDb>,
  id: string,
  branchId: string,
  userId: string,
  d: Record<string, unknown>,
  now: string,
): Promise<{ updatedRows: number; insertedFallback: boolean }> {
  const batchIds = Array.isArray(d.batch_ids) ? JSON.stringify(d.batch_ids) : '[]';
  const productIds = Array.isArray(d.product_ids) ? JSON.stringify(d.product_ids) : '[]';

  const updateResult = await db
    .prepare(
      `UPDATE offers
       SET name = ?, discount_percent = ?, batch_ids = ?, product_ids = ?,
           starts_at = ?, ends_at = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      String(d.name ?? ''),
      Number(d.discount_percent ?? 0),
      batchIds,
      productIds,
      String(d.starts_at ?? now),
      d.ends_at == null ? null : String(d.ends_at),
      String(d.status ?? 'active'),
      d.notes == null ? null : String(d.notes),
      now,
      id,
    )
    .run();

  let insertedFallback = false;

  if (updateResult.meta.changes === 0) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO offers
          (id, branch_id, user_id, name, discount_percent, batch_ids, product_ids,
           starts_at, ends_at, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        branchId,
        userId,
        String(d.name ?? ''),
        Number(d.discount_percent ?? 0),
        batchIds,
        productIds,
        String(d.starts_at ?? now),
        d.ends_at == null ? null : String(d.ends_at),
        String(d.status ?? 'active'),
        d.notes == null ? null : String(d.notes),
        now,
        now,
      )
      .run();
    insertedFallback = true;
  }

  return { updatedRows: updateResult.meta.changes, insertedFallback };
}

const OFFER_DATA = {
  name: 'Oferta medialuna',
  discount_percent: 10,
  batch_ids: ['batch-1'],
  product_ids: ['prod-a'],
  starts_at: '2026-06-22 00:00:00',
  ends_at: null,
  status: 'active',
  notes: null,
};

describe('syncOfferUpsert — case "offer" update con upsert manual', () => {
  it('UPDATE con changes=0 ejecuta INSERT de fallback', async () => {
    const db = makeDb(0);
    const result = await applyOfferUpdate(db, 'offer-1', 'branch-1', 'user-1', OFFER_DATA, '2026-06-22 10:00:00');

    expect(result.updatedRows).toBe(0);
    expect(result.insertedFallback).toBe(true);
    // Debe haber preparado 2 statements: UPDATE + INSERT
    expect(db.preparedStatements).toHaveLength(2);
    expect(db.preparedStatements[0].sql).toMatch(/UPDATE offers/i);
    expect(db.preparedStatements[1].sql).toMatch(/INSERT OR IGNORE INTO offers/i);
  });

  it('UPDATE con changes=1 NO ejecuta INSERT', async () => {
    const db = makeDb(1);
    const result = await applyOfferUpdate(db, 'offer-2', 'branch-1', 'user-1', OFFER_DATA, '2026-06-22 10:00:00');

    expect(result.updatedRows).toBe(1);
    expect(result.insertedFallback).toBe(false);
    // Solo debe haber preparado el UPDATE, sin INSERT
    expect(db.preparedStatements).toHaveLength(1);
    expect(db.preparedStatements[0].sql).toMatch(/UPDATE offers/i);
  });

  it('el INSERT de fallback usa los mismos campos del UPDATE (mismos datos del op)', async () => {
    const db = makeDb(0);
    await applyOfferUpdate(db, 'offer-3', 'branch-x', 'user-x', OFFER_DATA, '2026-06-22 10:00:00');

    const insertStmt = db.preparedStatements[1];
    expect(insertStmt).toBeDefined();
    const bindings = insertStmt.bindings;

    // id, branch_id, user_id, name, discount_percent, ...
    expect(bindings[0]).toBe('offer-3');              // id
    expect(bindings[1]).toBe('branch-x');              // branch_id
    expect(bindings[2]).toBe('user-x');                // user_id
    expect(bindings[3]).toBe('Oferta medialuna');      // name
    expect(bindings[4]).toBe(10);                      // discount_percent
    expect(bindings[5]).toBe(JSON.stringify(['batch-1'])); // batch_ids
    expect(bindings[6]).toBe(JSON.stringify(['prod-a']));  // product_ids
    expect(bindings[9]).toBe('active');                // status
  });
});
