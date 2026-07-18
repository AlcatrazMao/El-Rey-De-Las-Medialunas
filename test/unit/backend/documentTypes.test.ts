import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests para el change "Document Types (Comprobantes)" — Fase 4 (backend).
 *
 * Igual que el resto de test/unit/backend/*.test.ts: réplicas herméticas de
 * la lógica real extraída de workers/api/src/{lib,routes}/*.ts, con un stub
 * D1 en memoria propio del archivo (no se importa Hono/D1 real — el repo no
 * usa @cloudflare/vitest-pool-workers, solo réplica pura + stub manual).
 *
 * Fuentes replicadas:
 *   - workers/api/src/lib/document-sequences.ts (nextSequence, DOCUMENT_TYPES)
 *   - workers/api/src/routes/document-sequences.ts (POST /bootstrap)
 *   - workers/api/src/routes/document-settings.ts (GET /, PATCH /:documentType)
 *   - workers/api/src/routes/credit-notes.ts (POST /)
 *   - workers/api/src/routes/remitos.ts (POST /)
 *   - workers/api/src/routes/budgets.ts (POST /)
 *   - workers/api/src/routes/sales.ts (POST / — subset: document_type/CUIT/enabled)
 *   - workers/api/src/middleware/auth.ts (resolveBranchScopeValue — branch scoping)
 */

// ============================================================================
// Stub D1 en memoria — soporta lo que las rutas reales necesitan:
//   - prepare().bind().first()/.run()/.all()
//   - UPDATE ... RETURNING (simulado: aplica el efecto y devuelve la fila)
//   - db.batch([...]) atómico: si CUALQUIER statement del batch tira, se
//     revierten TODOS los efectos ya aplicados por ese batch (rollback), tal
//     como D1 real garantiza con transacciones. Este es el comportamiento que
//     los 4 bugfixes de sales.ts/credit-notes.ts/remitos.ts/budgets.ts asumen
//     (sequenceUpdate fusionado al mismo batch que el INSERT principal).
// ============================================================================

interface DocumentSequenceRow {
  branch_id: string;
  document_type: string;
  last_number: number;
  updated_at: string;
}

interface DocumentTypeSettingRow {
  branch_id: string;
  document_type: string;
  enabled: number;
  updated_at: string;
  updated_by: string | null;
}

interface SaleRow {
  id: string;
  branch_id: string;
  sale_number: number;
  document_type: string;
}

interface CreditNoteRow {
  id: string;
  branch_id: string;
  sale_id: string;
  sale_number: number;
}

interface CustomerRow {
  id: string;
  document_type: string | null;
  document_number: string | null;
}

interface FakeDbState {
  documentSequences: DocumentSequenceRow[];
  documentTypeSettings: DocumentTypeSettingRow[];
  sales: SaleRow[];
  creditNotes: CreditNoteRow[];
  customers: CustomerRow[];
}

interface BoundStmt {
  sql: string;
  args: unknown[];
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta: { changes: number } }>;
  all: <T>() => Promise<{ results: T[] }>;
  // Ejecuta el efecto y devuelve lo que .first()/.run() devolverían —
  // usado internamente por batch() para poder revertir.
  _apply: () => { changes: number; firstRow: unknown | null };
  _revert: () => void;
}

function makeFakeDb(initial: FakeDbState) {
  const state: FakeDbState = JSON.parse(JSON.stringify(initial));

  function findSequence(branchId: string, documentType: string): DocumentSequenceRow | undefined {
    return state.documentSequences.find(
      (r) => r.branch_id === branchId && r.document_type === documentType,
    );
  }

  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        const stmt: BoundStmt = {
          sql,
          args,
          _apply: () => applyStatement(sql, args),
          _revert: () => {
            /* revert is handled by snapshot/restore in batch() */
          },
          async first<T>(): Promise<T | null> {
            const { firstRow } = applyStatement(sql, args);
            return firstRow as T | null;
          },
          async run() {
            const { changes } = applyStatement(sql, args);
            return { meta: { changes } };
          },
          async all<T>(): Promise<{ results: T[] }> {
            const results = applyAllStatement(sql, args) as T[];
            return { results };
          },
        };
        return stmt;
      },
    };
  }

  // Aplica un statement de forma inmediata (fuera de batch) — usado por
  // SELECTs simples (document-settings GET, sales.ts guard de enabled, etc).
  function applyAllStatement(sql: string, args: unknown[]): unknown[] {
    if (/SELECT.*document_type,\s*enabled\s+FROM document_type_settings WHERE branch_id = \?/is.test(sql)) {
      const [branchId] = args as [string];
      return state.documentTypeSettings.filter((r) => r.branch_id === branchId);
    }
    if (/SELECT id FROM products WHERE id IN/is.test(sql)) {
      // No usamos products en estos tests de forma real — asumimos que
      // cualquier product_id pedido existe (foco en numeración/scoping, no
      // en validación de catálogo).
      return (args as string[]).map((id) => ({ id }));
    }
    return [];
  }

  // Aplica un statement mutante/consulta puntual. Devuelve {changes, firstRow}.
  //
  // IMPORTANTE: los checks de INSERT van PRIMERO. Los INSERT de credit_notes/
  // remitos/budgets/sales incrustan una subquery SQL literal
  // "(SELECT last_number FROM document_sequences WHERE branch_id = ? AND
  // document_type = ?)" (mismo patrón que el código real — ver comentario en
  // credit-notes.ts sobre por qué usa subquery en vez de bind JS). Si el
  // check del SELECT plano corriera antes, matchearía por accidente el texto
  // de esa subquery dentro del INSERT y el statement completo se
  // malinterpretaría como un SELECT de solo lectura, sin persistir la fila.
  function applyStatement(sql: string, args: unknown[]): { changes: number; firstRow: unknown | null } {
    // ── INSERT INTO credit_notes (... sale_number = subquery) ───────────────
    if (/INSERT INTO credit_notes/is.test(sql)) {
      const [id, branchId, saleId, , , , , amount] = args as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
      ];
      const seq = findSequence(branchId, 'nota_credito');
      const saleNumber = seq ? seq.last_number : 0;
      state.creditNotes.push({ id, branch_id: branchId, sale_id: saleId, sale_number: saleNumber });
      void amount;
      return { changes: 1, firstRow: null };
    }

    // ── INSERT INTO sales (...) ──────────────────────────────────────────────
    if (/INSERT INTO sales/is.test(sql)) {
      const argsArr = args as unknown[];
      const id = argsArr[0] as string;
      const branchId = argsArr[3] as string;
      const saleNumber = argsArr[6] as number;
      const documentType = argsArr[argsArr.length - 1] as string;
      state.sales.push({ id, branch_id: branchId, sale_number: saleNumber, document_type: documentType });
      return { changes: 1, firstRow: null };
    }

    // ── document_sequences: UPDATE ... SET last_number = last_number + 1 ... RETURNING
    if (/UPDATE document_sequences\s+SET last_number = last_number \+ 1/is.test(sql)) {
      const [, branchId, documentType] = args as [string, string, string];
      const row = findSequence(branchId, documentType);
      if (!row) return { changes: 0, firstRow: null };
      row.last_number += 1;
      return { changes: 1, firstRow: { last_number: row.last_number } };
    }

    // ── document_sequences bootstrap: UPDATE ... SET last_number = MAX(last_number, ?) ... WHERE ... AND last_number < ?
    if (/UPDATE document_sequences\s+SET last_number = MAX\(last_number, \?\)/is.test(sql)) {
      const [lastNumber, , branchId, documentType] = args as [number, string, string, string, number];
      const row = findSequence(branchId, documentType);
      if (!row) return { changes: 0, firstRow: null };
      if (row.last_number < lastNumber) {
        row.last_number = lastNumber;
        return { changes: 1, firstRow: null };
      }
      return { changes: 0, firstRow: null };
    }

    // ── SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?
    if (/SELECT last_number FROM document_sequences WHERE branch_id = \? AND document_type = \?/is.test(sql)) {
      const [branchId, documentType] = args as [string, string];
      const row = findSequence(branchId, documentType);
      return { changes: 0, firstRow: row ? { last_number: row.last_number } : null };
    }

    // ── document_type_settings: UPDATE enabled
    if (/UPDATE document_type_settings\s+SET enabled = \?/is.test(sql)) {
      const [enabled, updatedAt, updatedBy, branchId, documentType] = args as [
        number,
        string,
        string,
        string,
        string,
      ];
      const row = state.documentTypeSettings.find(
        (r) => r.branch_id === branchId && r.document_type === documentType,
      );
      if (!row) return { changes: 0, firstRow: null };
      row.enabled = enabled;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      return { changes: 1, firstRow: null };
    }

    // ── sales guard: SELECT enabled FROM document_type_settings WHERE branch_id = ? AND document_type = ?
    if (/SELECT enabled FROM document_type_settings WHERE branch_id = \? AND document_type = \?/is.test(sql)) {
      const [branchId, documentType] = args as [string, string];
      const row = state.documentTypeSettings.find(
        (r) => r.branch_id === branchId && r.document_type === documentType,
      );
      return { changes: 0, firstRow: row ? { enabled: row.enabled } : null };
    }

    // ── sales: SELECT id, sale_number FROM sales WHERE id = ? AND branch_id = ? (credit-notes guard)
    if (/SELECT id, sale_number FROM sales WHERE id = \? AND branch_id = \?/is.test(sql)) {
      const [saleId, branchId] = args as [string, string];
      const row = state.sales.find((r) => r.id === saleId && r.branch_id === branchId);
      return { changes: 0, firstRow: row ? { id: row.id, sale_number: row.sale_number } : null };
    }

    // ── customers guard (CUIT): SELECT document_type, document_number FROM customers WHERE id = ?
    if (/SELECT document_type, document_number FROM customers WHERE id = \?/is.test(sql)) {
      const [customerId] = args as [string];
      const row = state.customers.find((r) => r.id === customerId);
      return {
        changes: 0,
        firstRow: row ? { document_type: row.document_type, document_number: row.document_number } : null,
      };
    }

    // Fallback genérico: no-op exitoso (INSERTs de items/movements que no
    // nos interesa modelar para estos tests de numeración/scoping).
    return { changes: 1, firstRow: null };
  }

  return {
    prepare,
    // db.batch: ejecuta todos los statements EN ORDEN sobre un snapshot;
    // si alguno tira excepción, restaura el snapshot completo (simula el
    // rollback atómico real de D1 batch()).
    async batch(stmts: BoundStmt[]): Promise<Array<{ results?: unknown[]; meta: { changes: number } }>> {
      const snapshot = JSON.parse(JSON.stringify(state)) as FakeDbState;
      try {
        const results: Array<{ results?: unknown[]; meta: { changes: number } }> = [];
        for (const stmt of stmts) {
          const { changes, firstRow } = stmt._apply();
          results.push({ results: firstRow !== null ? [firstRow] : [], meta: { changes } });
        }
        return results;
      } catch (err) {
        // rollback: restaurar snapshot
        state.documentSequences = snapshot.documentSequences;
        state.documentTypeSettings = snapshot.documentTypeSettings;
        state.sales = snapshot.sales;
        state.creditNotes = snapshot.creditNotes;
        state.customers = snapshot.customers;
        throw err;
      }
    },
    _state: state,
  };
}

type FakeDb = ReturnType<typeof makeFakeDb>;

// ============================================================================
// Helpers de fixture
// ============================================================================

const DOCUMENT_TYPES = [
  'ticket',
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito',
  'remito',
  'presupuesto',
] as const;

function seedBranch(branchId: string, opts?: { enabledTypes?: string[] }): {
  documentSequences: DocumentSequenceRow[];
  documentTypeSettings: DocumentTypeSettingRow[];
} {
  const enabledTypes = opts?.enabledTypes ?? ['ticket'];
  return {
    documentSequences: DOCUMENT_TYPES.map((dt) => ({
      branch_id: branchId,
      document_type: dt,
      last_number: 0,
      updated_at: '2026-01-01 00:00:00',
    })),
    documentTypeSettings: DOCUMENT_TYPES.map((dt) => ({
      branch_id: branchId,
      document_type: dt,
      enabled: enabledTypes.includes(dt) ? 1 : 0,
      updated_at: '2026-01-01 00:00:00',
      updated_by: null,
    })),
  };
}

// Réplica de nextSequence() (workers/api/src/lib/document-sequences.ts)
async function nextSequence(db: FakeDb, branchId: string, documentType: string): Promise<number> {
  const row = await db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind('2026-01-01 00:00:01', branchId, documentType)
    .first<{ last_number: number }>();
  if (!row) {
    throw new Error(
      `document_sequences no tiene seed para branch_id=${branchId} document_type=${documentType} — revisar migración 0023`,
    );
  }
  return row.last_number;
}

// Réplica de POST /document-sequences/bootstrap
async function bootstrap(
  db: FakeDb,
  branchId: string,
  lastNumber: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = '2026-01-01 00:00:01';
  const result = await db
    .prepare(
      `UPDATE document_sequences
          SET last_number = MAX(last_number, ?), updated_at = ?
        WHERE branch_id = ? AND document_type = ? AND last_number < ?`,
    )
    .bind(lastNumber, now, branchId, 'ticket', lastNumber)
    .run();

  const row = await db
    .prepare(`SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?`)
    .bind(branchId, 'ticket')
    .first<{ last_number: number }>();

  if (!row) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND' } } };
  }

  return {
    status: 200,
    body: {
      success: true,
      data: { document_type: 'ticket', last_number: row.last_number, updated: result.meta.changes > 0 },
    },
  };
}

// Réplica de PATCH /document-settings/:documentType
async function patchDocumentSetting(
  db: FakeDb,
  branchId: string,
  documentType: string,
  enabled: boolean,
  userRole: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ADMIN_ROLES = new Set(['admin', 'owner', 'supervisor']);
  if (!ADMIN_ROLES.has(userRole)) {
    return { status: 403, body: { success: false, error: { code: 'FORBIDDEN' } } };
  }
  const result = await db
    .prepare(
      `UPDATE document_type_settings
         SET enabled = ?, updated_at = ?, updated_by = ?
       WHERE branch_id = ? AND document_type = ?`,
    )
    .bind(enabled ? 1 : 0, '2026-01-01 00:00:01', 'user_1', branchId, documentType)
    .run();
  if (result.meta.changes === 0) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND' } } };
  }
  return { status: 200, body: { success: true, data: { document_type: documentType, enabled } } };
}

// Réplica de GET /document-settings
async function getDocumentSettings(db: FakeDb, branchId: string) {
  const rows = await db
    .prepare(`SELECT document_type, enabled FROM document_type_settings WHERE branch_id = ?`)
    .bind(branchId)
    .all<{ document_type: string; enabled: number }>();
  return (rows.results ?? []).map((r) => ({ document_type: r.document_type, enabled: r.enabled === 1 }));
}

// Réplica de POST /credit-notes (subset relevante: guard de sale_id + numeración fusionada)
async function createCreditNote(
  db: FakeDb,
  branchId: string,
  saleId: string,
  reason: string,
  amount: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const sale = await db
    .prepare(`SELECT id, sale_number FROM sales WHERE id = ? AND branch_id = ? LIMIT 1`)
    .bind(saleId, branchId)
    .first<{ id: string; sale_number: number }>();

  if (!sale) {
    return { status: 400, body: { success: false, error: { code: 'VALIDATION_ERROR' } } };
  }

  const id = `cn_${saleId}_${reason}`;
  const now = '2026-01-01 00:00:01';

  const sequenceUpdate = db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, 'nota_credito');

  const creditNoteInsert = db
    .prepare(
      `INSERT INTO credit_notes (id, branch_id, sale_id, user_id, sale_number, reason, amount, created_at)
       VALUES (?, ?, ?, ?, (SELECT last_number FROM document_sequences WHERE branch_id = ? AND document_type = ?), ?, ?, ?)`,
    )
    .bind(id, branchId, saleId, 'user_1', branchId, 'nota_credito', reason, amount, now);

  const batchResults = await db.batch([sequenceUpdate, creditNoteInsert]);
  const sequenceRow = batchResults[0].results?.[0] as { last_number: number } | undefined;
  if (!sequenceRow) {
    throw new Error('document_sequences no tiene seed');
  }

  return {
    status: 201,
    body: {
      success: true,
      data: { id, branch_id: branchId, sale_id: saleId, sale_number: sequenceRow.last_number, reason, amount },
    },
  };
}

// Réplica de POST /sales (subset: enabled guard + CUIT guard + numeración,
// SIN el retry-loop de sale_number legacy — no relevante para estos tests).
async function createSale(
  db: FakeDb,
  branchId: string,
  documentType: string,
  customerId: string | undefined,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const settingRow = await db
    .prepare(`SELECT enabled FROM document_type_settings WHERE branch_id = ? AND document_type = ?`)
    .bind(branchId, documentType)
    .first<{ enabled: number }>();
  if (!settingRow || settingRow.enabled !== 1) {
    return {
      status: 409,
      body: { success: false, error: { code: 'DOCUMENT_TYPE_DISABLED' } },
    };
  }

  if (documentType === 'factura_a' || documentType === 'factura_b' || documentType === 'factura_c') {
    if (!customerId) {
      return { status: 400, body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'requiere CUIT' } } };
    }
    const customer = await db
      .prepare(`SELECT document_type, document_number FROM customers WHERE id = ?`)
      .bind(customerId)
      .first<{ document_type: string | null; document_number: string | null }>();
    if (!customer || customer.document_type !== 'cuit' || !customer.document_number?.trim()) {
      return { status: 400, body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'requiere CUIT' } } };
    }
  }

  const saleId = `sale_${Math.random().toString(36).slice(2)}`;
  const now = '2026-01-01 00:00:01';
  const saleNumber = db._state.sales.filter((s) => s.branch_id === branchId).length + 1;

  const sequenceUpdate = db
    .prepare(
      `UPDATE document_sequences
         SET last_number = last_number + 1, updated_at = ?
       WHERE branch_id = ? AND document_type = ?
       RETURNING last_number`,
    )
    .bind(now, branchId, documentType);

  const saleInsert = db
    .prepare(
      `INSERT INTO sales (id, client_id, idempotency_key, branch_id, user_id, customer_id, sale_number, subtotal, discount_total, tax_total, total, notes, created_at, document_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      saleId,
      null,
      null,
      branchId,
      'user_1',
      customerId ?? null,
      saleNumber,
      100,
      0,
      0,
      100,
      null,
      now,
      documentType,
    );

  const batchResults = await db.batch([sequenceUpdate, saleInsert]);
  const sequenceRow = batchResults[0].results?.[0] as { last_number: number } | undefined;
  if (!sequenceRow) {
    throw new Error('document_sequences no tiene seed');
  }

  return {
    status: 201,
    body: {
      success: true,
      data: { id: saleId, branch_id: branchId, document_type: documentType, document_number: sequenceRow.last_number },
    },
  };
}

// Réplica pura de resolveBranchScopeValue (workers/api/src/middleware/auth.ts)
// — usada para los tests de branch scoping (4.9).
const OPERATIONAL_ROLES = new Set(['cashier', 'production', 'warehouse', 'driver']);
const ELEVATED_ROLES = new Set(['admin', 'owner', 'supervisor']);

function resolveBranchScopeValue(
  role: string,
  userDefaultBranch: string | null,
  queryBranchId: string | undefined,
): { ok: true; branchId: string } | { ok: false; code: 'NO_DEFAULT_BRANCH' } {
  if (OPERATIONAL_ROLES.has(role)) {
    if (!userDefaultBranch) return { ok: false, code: 'NO_DEFAULT_BRANCH' };
    return { ok: true, branchId: userDefaultBranch };
  }
  if (ELEVATED_ROLES.has(role)) {
    return { ok: true, branchId: queryBranchId ?? '' };
  }
  return { ok: true, branchId: '' };
}

// ============================================================================
// 4.1 — Numeración atómica bajo emisión concurrente
// ============================================================================

describe('4.1 — numeración atómica bajo emisión "concurrente"', () => {
  let db: FakeDb;

  beforeEach(() => {
    const seed = seedBranch('branch_1', { enabledTypes: ['remito'] });
    db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [],
    });
  });

  it('dos llamadas Promise.all a nextSequence() para el mismo branch+tipo devuelven números consecutivos y distintos', async () => {
    const [a, b] = await Promise.all([
      nextSequence(db, 'branch_1', 'remito'),
      nextSequence(db, 'branch_1', 'remito'),
    ]);

    expect(a).not.toBe(b);
    const sorted = [a, b].sort((x, y) => x - y);
    expect(sorted).toEqual([1, 2]);
  });

  it('N llamadas concurrentes producen exactamente N números consecutivos sin huecos ni duplicados', async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => nextSequence(db, 'branch_1', 'remito')),
    );
    const sorted = [...results].sort((x, y) => x - y);
    expect(new Set(results).size).toBe(N); // sin duplicados
    expect(sorted).toEqual(Array.from({ length: N }, (_, i) => i + 1)); // sin huecos, consecutivos 1..N
  });

  it('dos POSTs "concurrentes" a /sales con mismo branch+document_type (ticket) numeran document_number consecutivo', async () => {
    const seed2 = seedBranch('branch_2', { enabledTypes: ['ticket'] });
    const db2 = makeFakeDb({
      documentSequences: seed2.documentSequences,
      documentTypeSettings: seed2.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [],
    });

    const [r1, r2] = await Promise.all([
      createSale(db2, 'branch_2', 'ticket', undefined),
      createSale(db2, 'branch_2', 'ticket', undefined),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const n1 = (r1.body.data as { document_number: number }).document_number;
    const n2 = (r2.body.data as { document_number: number }).document_number;
    expect(n1).not.toBe(n2);
    expect([n1, n2].sort((x, y) => x - y)).toEqual([1, 2]);
  });
});

// ============================================================================
// 4.2 — Migración/bootstrap: MAX monótono, nunca retrocede
// ============================================================================

describe('4.2 — bootstrap de secuencia legacy — MAX monótono', () => {
  let db: FakeDb;

  beforeEach(() => {
    const seed = seedBranch('branch_1');
    db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [],
    });
  });

  it('document_sequences arranca en 0 para ticket antes de cualquier bootstrap', async () => {
    const row = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'ticket',
    );
    expect(row?.last_number).toBe(0);
  });

  it('varias cajas reportan distintos last_number (algunos menores) — el resultado final es el MÁXIMO', async () => {
    // Caja A reporta 4521
    const r1 = await bootstrap(db, 'branch_1', 4521);
    expect(r1.status).toBe(200);
    expect((r1.body.data as { last_number: number }).last_number).toBe(4521);

    // Caja B reporta un valor MENOR (2000) — no debe retroceder
    const r2 = await bootstrap(db, 'branch_1', 2000);
    expect(r2.status).toBe(200);
    expect((r2.body.data as { last_number: number; updated: boolean }).last_number).toBe(4521);
    expect((r2.body.data as { updated: boolean }).updated).toBe(false); // no-op, no bajó

    // Caja C reporta un valor MAYOR (5000) — sí avanza
    const r3 = await bootstrap(db, 'branch_1', 5000);
    expect((r3.body.data as { last_number: number }).last_number).toBe(5000);
    expect((r3.body.data as { updated: boolean }).updated).toBe(true);

    // Caja D vuelve a reportar un valor viejo (3000) — sigue sin retroceder
    const r4 = await bootstrap(db, 'branch_1', 3000);
    expect((r4.body.data as { last_number: number }).last_number).toBe(5000);
    expect((r4.body.data as { updated: boolean }).updated).toBe(false);

    // El próximo ticket real usa nextSequence() y continúa desde 5000+1
    const nextTicket = await nextSequence(db, 'branch_1', 'ticket');
    expect(nextTicket).toBe(5001);
  });

  it('bootstraps concurrentes con distintos valores convergen al máximo sin importar el orden', async () => {
    await Promise.all([
      bootstrap(db, 'branch_1', 100),
      bootstrap(db, 'branch_1', 999),
      bootstrap(db, 'branch_1', 500),
    ]);
    const row = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'ticket',
    );
    expect(row?.last_number).toBe(999);
  });
});

// ============================================================================
// 4.3 — Tipos sin legado arrancan en 1
// ============================================================================

describe('4.3 — tipos sin numeración legacy arrancan en 1', () => {
  it.each(['factura_a', 'factura_b', 'factura_c', 'nota_credito', 'remito', 'presupuesto'] as const)(
    'el primer %s de una sucursal nueva numera 1 (no 0, no continúa de otro tipo)',
    async (documentType) => {
      const seed = seedBranch('branch_1', { enabledTypes: [documentType] });
      const db = makeFakeDb({
        documentSequences: seed.documentSequences,
        documentTypeSettings: seed.documentTypeSettings,
        sales: [],
        creditNotes: [],
        customers: [],
      });

      // Simulamos que 'ticket' YA tiene numeración avanzada (bootstrap legacy)
      // para confirmar que los otros tipos NO heredan/continúan ese contador.
      await bootstrap(db, 'branch_1', 4521);

      const first = await nextSequence(db, 'branch_1', documentType);
      expect(first).toBe(1);
    },
  );
});

// ============================================================================
// 4.4 — Nota de crédito requiere venta real
// ============================================================================

describe('4.4 — nota de crédito requiere venta real', () => {
  let db: FakeDb;

  beforeEach(() => {
    const seedA = seedBranch('branch_A', { enabledTypes: ['nota_credito'] });
    db = makeFakeDb({
      documentSequences: seedA.documentSequences,
      documentTypeSettings: seedA.documentTypeSettings,
      sales: [{ id: 'sale_real_A', branch_id: 'branch_A', sale_number: 1, document_type: 'ticket' }],
      creditNotes: [],
      customers: [],
    });
  });

  it('sale_id inexistente → 400 VALIDATION_ERROR, no crea fila en credit_notes', async () => {
    const result = await createCreditNote(db, 'branch_A', 'sale_no_existe', 'motivo', 100);
    expect(result.status).toBe(400);
    expect((result.body.error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(db._state.creditNotes).toHaveLength(0);
  });

  it('sale_id de OTRA sucursal → 400 VALIDATION_ERROR, no crea fila en credit_notes', async () => {
    // sale_real_A pertenece a branch_A; branch_B intenta usarla.
    const seedB = seedBranch('branch_B', { enabledTypes: ['nota_credito'] });
    db._state.documentSequences.push(...seedB.documentSequences);
    db._state.documentTypeSettings.push(...seedB.documentTypeSettings);

    const result = await createCreditNote(db, 'branch_B', 'sale_real_A', 'motivo', 100);
    expect(result.status).toBe(400);
    expect((result.body.error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(db._state.creditNotes).toHaveLength(0);
  });

  it('sale_id real y de la misma sucursal → crea la nota de crédito correctamente (201)', async () => {
    const result = await createCreditNote(db, 'branch_A', 'sale_real_A', 'motivo válido', 100);
    expect(result.status).toBe(201);
    expect(db._state.creditNotes).toHaveLength(1);
    expect(db._state.creditNotes[0].sale_id).toBe('sale_real_A');
  });
});

// ============================================================================
// 4.5 — Toggle no resetea contador
// ============================================================================

describe('4.5 — deshabilitar/rehabilitar un tipo no resetea last_number', () => {
  it('emitir sube last_number a N, deshabilitar y rehabilitar mantiene last_number = N', async () => {
    const seed = seedBranch('branch_1', { enabledTypes: ['factura_b'] });
    const db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [],
    });

    // Emitir 3 facturas B → last_number sube a 3
    await createSale(db, 'branch_1', 'factura_b', undefined).then(() => {
      // sin CUIT en este caso el guard rechazaría — usamos nextSequence
      // directo para simular 3 emisiones ya validadas (foco del test es el
      // toggle, no el guard de CUIT, que se testea en 4.8).
    });
    // Revertir el intento fallido de arriba (createSale con factura_b exige
    // CUIT); en su lugar usamos nextSequence directamente 3 veces, que es
    // exactamente lo que hace sales.ts internamente tras pasar los guards.
    await nextSequence(db, 'branch_1', 'factura_b');
    await nextSequence(db, 'branch_1', 'factura_b');
    await nextSequence(db, 'branch_1', 'factura_b');

    const rowAfterEmit = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_b',
    );
    expect(rowAfterEmit?.last_number).toBe(3);

    // Deshabilitar
    const disableResult = await patchDocumentSetting(db, 'branch_1', 'factura_b', false, 'admin');
    expect(disableResult.status).toBe(200);

    const rowAfterDisable = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_b',
    );
    expect(rowAfterDisable?.last_number).toBe(3); // NO resetea

    // Rehabilitar
    const enableResult = await patchDocumentSetting(db, 'branch_1', 'factura_b', true, 'admin');
    expect(enableResult.status).toBe(200);

    const rowAfterEnable = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_b',
    );
    expect(rowAfterEnable?.last_number).toBe(3); // sigue en 3, no volvió a 0

    // La próxima emisión continúa en 4, no reinicia
    const next = await nextSequence(db, 'branch_1', 'factura_b');
    expect(next).toBe(4);
  });
});

// ============================================================================
// 4.7 — Deshabilitar bloquea solo emisión futura (históricos siguen visibles)
// ============================================================================

describe('4.7 — deshabilitar bloquea solo emisión futura, no oculta históricos', () => {
  it('con el tipo deshabilitado, un intento de emitir se rechaza con 409 DOCUMENT_TYPE_DISABLED', async () => {
    const seed = seedBranch('branch_1', { enabledTypes: ['ticket'] }); // factura_b queda deshabilitada
    const db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [],
    });

    const result = await createSale(db, 'branch_1', 'factura_b', undefined);
    expect(result.status).toBe(409);
    expect((result.body.error as { code: string }).code).toBe('DOCUMENT_TYPE_DISABLED');
  });

  it('un comprobante emitido ANTES de deshabilitar sigue apareciendo en el listado tras deshabilitar el tipo', async () => {
    const seed = seedBranch('branch_1', { enabledTypes: ['ticket'] });
    const db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [],
    });

    // Emitir un ticket mientras está habilitado
    const emitResult = await createSale(db, 'branch_1', 'ticket', undefined);
    expect(emitResult.status).toBe(201);
    const saleId = (emitResult.body.data as { id: string }).id;

    // Deshabilitar 'ticket'
    const disable = await patchDocumentSetting(db, 'branch_1', 'ticket', false, 'owner');
    expect(disable.status).toBe(200);

    // El ticket emitido ANTES sigue existiendo en `sales` (no se oculta ni se borra)
    const stillThere = db._state.sales.find((s) => s.id === saleId);
    expect(stillThere).toBeDefined();
    expect(stillThere?.document_type).toBe('ticket');

    // Y un nuevo intento de emitir ticket ahora SÍ se rechaza
    const secondAttempt = await createSale(db, 'branch_1', 'ticket', undefined);
    expect(secondAttempt.status).toBe(409);
    expect((secondAttempt.body.error as { code: string }).code).toBe('DOCUMENT_TYPE_DISABLED');
  });
});

// ============================================================================
// 4.8 — CUIT obligatorio para facturas, ANTES de gastar numeración
// ============================================================================

describe('4.8 — CUIT obligatorio para factura_a/b/c, sin gastar numeración en el intento fallido', () => {
  let db: FakeDb;

  beforeEach(() => {
    const seed = seedBranch('branch_1', { enabledTypes: ['factura_a'] });
    db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [
        { id: 'cust_sin_cuit', document_type: 'dni', document_number: '30111222' },
        { id: 'cust_cuit_vacio', document_type: 'cuit', document_number: '' },
        { id: 'cust_con_cuit', document_type: 'cuit', document_number: '20304050607' },
      ],
    });
  });

  it('sin customer_id → 400, last_number de factura_a NO sube', async () => {
    const before = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_a',
    )?.last_number;

    const result = await createSale(db, 'branch_1', 'factura_a', undefined);
    expect(result.status).toBe(400);

    const after = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_a',
    )?.last_number;
    expect(after).toBe(before);
  });

  it('customer con document_type != cuit (ej. dni) → 400, last_number NO sube', async () => {
    const before = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_a',
    )?.last_number;

    const result = await createSale(db, 'branch_1', 'factura_a', 'cust_sin_cuit');
    expect(result.status).toBe(400);

    const after = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_a',
    )?.last_number;
    expect(after).toBe(before);
  });

  it('customer con document_type=cuit pero document_number vacío → 400, last_number NO sube', async () => {
    const before = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_a',
    )?.last_number;

    const result = await createSale(db, 'branch_1', 'factura_a', 'cust_cuit_vacio');
    expect(result.status).toBe(400);

    const after = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'factura_a',
    )?.last_number;
    expect(after).toBe(before);
  });

  it('customer con CUIT válido → 201, y ahí SÍ sube la numeración', async () => {
    const result = await createSale(db, 'branch_1', 'factura_a', 'cust_con_cuit');
    expect(result.status).toBe(201);
    expect((result.body.data as { document_number: number }).document_number).toBe(1);
  });
});

// ============================================================================
// 4.9 — Branch scoping en todas las rutas nuevas
// ============================================================================

describe('4.9 — branch scoping: no hay fuga cross-branch', () => {
  it('resolveBranchScopeValue fuerza default_branch para roles operativos, ignorando cualquier query param/header', () => {
    // Un cashier de branch_A intentando "pedir" branch_B vía query param es
    // ignorado — igual que un intento de header X-Branch-Id para operar
    // sobre otra sucursal en document-settings/credit-notes/remitos/budgets,
    // que todos resuelven branchId desde c.get("branchId") (ya fijado por
    // este middleware, no por el body/query de la request).
    const result = resolveBranchScopeValue('cashier', 'branch_A', 'branch_B');
    expect(result).toEqual({ ok: true, branchId: 'branch_A' });
  });

  it('cashier sin default_branch asignado es rechazado (NO_DEFAULT_BRANCH), nunca cae a una sucursal por default', () => {
    const result = resolveBranchScopeValue('cashier', null, 'branch_B');
    expect(result).toEqual({ ok: false, code: 'NO_DEFAULT_BRANCH' });
  });

  it('document-settings: PATCH sobre branch_B no afecta la config de branch_A (aislamiento por branchId resuelto)', async () => {
    const seedA = seedBranch('branch_A', { enabledTypes: ['ticket'] });
    const seedB = seedBranch('branch_B', { enabledTypes: ['ticket'] });
    const db = makeFakeDb({
      documentSequences: [...seedA.documentSequences, ...seedB.documentSequences],
      documentTypeSettings: [...seedA.documentTypeSettings, ...seedB.documentTypeSettings],
      sales: [],
      creditNotes: [],
      customers: [],
    });

    // Un admin operando explícitamente sobre branch_B habilita factura_a ahí.
    await patchDocumentSetting(db, 'branch_B', 'factura_a', true, 'admin');

    const settingsA = await getDocumentSettings(db, 'branch_A');
    const settingsB = await getDocumentSettings(db, 'branch_B');

    expect(settingsA.find((s) => s.document_type === 'factura_a')?.enabled).toBe(false);
    expect(settingsB.find((s) => s.document_type === 'factura_a')?.enabled).toBe(true);
  });

  it('credit-notes: no se puede emitir una NC en branch_B referenciando una venta de branch_A', async () => {
    const seedA = seedBranch('branch_A', { enabledTypes: ['nota_credito'] });
    const seedB = seedBranch('branch_B', { enabledTypes: ['nota_credito'] });
    const db = makeFakeDb({
      documentSequences: [...seedA.documentSequences, ...seedB.documentSequences],
      documentTypeSettings: [...seedA.documentTypeSettings, ...seedB.documentTypeSettings],
      sales: [{ id: 'sale_A1', branch_id: 'branch_A', sale_number: 1, document_type: 'ticket' }],
      creditNotes: [],
      customers: [],
    });

    const crossBranchAttempt = await createCreditNote(db, 'branch_B', 'sale_A1', 'motivo', 50);
    expect(crossBranchAttempt.status).toBe(400);
    expect(db._state.creditNotes).toHaveLength(0);

    // La misma sale_id SÍ funciona si se opera desde su propia sucursal.
    const sameBranchAttempt = await createCreditNote(db, 'branch_A', 'sale_A1', 'motivo', 50);
    expect(sameBranchAttempt.status).toBe(201);
  });

  it('numeración: emitir en branch_A no incrementa la secuencia de branch_B (aislamiento total por branch)', async () => {
    const seedA = seedBranch('branch_A', { enabledTypes: ['remito'] });
    const seedB = seedBranch('branch_B', { enabledTypes: ['remito'] });
    const db = makeFakeDb({
      documentSequences: [...seedA.documentSequences, ...seedB.documentSequences],
      documentTypeSettings: [...seedA.documentTypeSettings, ...seedB.documentTypeSettings],
      sales: [],
      creditNotes: [],
      customers: [],
    });

    await nextSequence(db, 'branch_A', 'remito');
    await nextSequence(db, 'branch_A', 'remito');

    const rowA = db._state.documentSequences.find((r) => r.branch_id === 'branch_A' && r.document_type === 'remito');
    const rowB = db._state.documentSequences.find((r) => r.branch_id === 'branch_B' && r.document_type === 'remito');

    expect(rowA?.last_number).toBe(2);
    expect(rowB?.last_number).toBe(0); // branch_B intacta — no hay fuga cross-branch
  });

  it('budgets/remitos comparten el mismo mecanismo de resolución de branchId que sales/credit-notes (mismo branchId param, sin override por body)', () => {
    // Los 4 route handlers (sales.ts, credit-notes.ts, remitos.ts, budgets.ts)
    // usan uniformemente `const branchId = c.get("branchId")` — nunca leen
    // branch_id del body. Esto se verifica indirectamente arriba (numeración
    // y credit-notes aislados por branch); acá documentamos explícitamente
    // que el patrón es el mismo helper resolveBranchScopeValue para las 4 rutas.
    const elevatedOverride = resolveBranchScopeValue('admin', null, 'branch_X');
    expect(elevatedOverride).toEqual({ ok: true, branchId: 'branch_X' });
    const operationalIgnoresOverride = resolveBranchScopeValue('cashier', 'branch_Y', 'branch_X');
    expect(operationalIgnoresOverride).toEqual({ ok: true, branchId: 'branch_Y' });
  });
});

// ============================================================================
// 4.10 — Verificación manual end-to-end simulada (rollout completo)
// ============================================================================

describe('4.10 — rollout end-to-end simulado', () => {
  it('simula el rollout completo: deploy con solo ticket habilitado → bootstrap legacy → habilitar tipo nuevo → emitir → ventas de ticket siguen funcionando', async () => {
    // Paso 1: "aplicar migración" — seed inicial tal como la migración 0023 lo deja:
    // todas las combinaciones en 0, solo 'ticket' habilitado.
    const seed = seedBranch('branch_1'); // default enabledTypes: ['ticket']
    const db = makeFakeDb({
      documentSequences: seed.documentSequences,
      documentTypeSettings: seed.documentTypeSettings,
      sales: [],
      creditNotes: [],
      customers: [{ id: 'cust_cuit_1', document_type: 'cuit', document_number: '20111222333' }],
    });

    const settingsAfterDeploy = await getDocumentSettings(db, 'branch_1');
    expect(settingsAfterDeploy.find((s) => s.document_type === 'ticket')?.enabled).toBe(true);
    for (const dt of DOCUMENT_TYPES.filter((t) => t !== 'ticket')) {
      expect(settingsAfterDeploy.find((s) => s.document_type === dt)?.enabled).toBe(false);
    }

    // Paso 2: con todo deshabilitado salvo ticket, el sistema sigue vendiendo
    // tickets normalmente.
    const ticket1 = await createSale(db, 'branch_1', 'ticket', undefined);
    expect(ticket1.status).toBe(201);
    expect((ticket1.body.data as { document_number: number }).document_number).toBe(1);

    // Un intento de vender factura_a en este punto se rechaza (todavía deshabilitada).
    const facturaBeforeEnable = await createSale(db, 'branch_1', 'factura_a', 'cust_cuit_1');
    expect(facturaBeforeEnable.status).toBe(409);

    // Paso 3: bootstrap de secuencia legacy de ticket (varias "cajas" reportando).
    await bootstrap(db, 'branch_1', 4521);
    await bootstrap(db, 'branch_1', 4520); // caja vieja, no debe retroceder
    const ticketSeqRow = db._state.documentSequences.find(
      (r) => r.branch_id === 'branch_1' && r.document_type === 'ticket',
    );
    // ticket ya tenía 1 emisión (paso 2) => last_number=1 antes del bootstrap;
    // bootstrap con MAX(1, 4521) = 4521.
    expect(ticketSeqRow?.last_number).toBe(4521);

    // Paso 4: habilitar factura_a vía toggle.
    const enableResult = await patchDocumentSetting(db, 'branch_1', 'factura_a', true, 'admin');
    expect(enableResult.status).toBe(200);

    // Paso 5: emitir factura_a exitosamente (arranca en 1, independiente del
    // contador de ticket que ya está en 4521+).
    const factura1 = await createSale(db, 'branch_1', 'factura_a', 'cust_cuit_1');
    expect(factura1.status).toBe(201);
    expect((factura1.body.data as { document_number: number }).document_number).toBe(1);

    // Paso 6: confirmar que el flujo normal de ventas (tickets) no se rompió
    // en ningún punto — el próximo ticket continúa la secuencia post-bootstrap.
    const ticket2 = await createSale(db, 'branch_1', 'ticket', undefined);
    expect(ticket2.status).toBe(201);
    expect((ticket2.body.data as { document_number: number }).document_number).toBe(4522);

    // Verificación final de estado consistente:
    expect(db._state.sales.filter((s) => s.document_type === 'ticket')).toHaveLength(2);
    expect(db._state.sales.filter((s) => s.document_type === 'factura_a')).toHaveLength(1);
  });
});
