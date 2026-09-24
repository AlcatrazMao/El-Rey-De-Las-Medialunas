// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8');
}

describe('credit note migration 0024', () => {
  it('rebuilds the table after 0023 without index collisions and preserves notes', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(migration('0001_initial_schema.sql'));
      db.exec(`INSERT INTO branches (id, name, code) VALUES ('b', 'Central', 'CC');
        INSERT INTO users (id, firebase_uid, email, name, role) VALUES ('u', 'uid', 'test@example.invalid', 'Test', 'admin');`);
      db.exec(migration('0023_document_types.sql'));
      db.exec(`INSERT INTO sales (id, branch_id, user_id, sale_number, subtotal, total)
        VALUES ('s', 'b', 'u', 1, 10, 10);`);
      db.exec(`INSERT INTO credit_notes (id, branch_id, sale_id, user_id, sale_number, reason, amount)
        VALUES ('cn', 'b', 's', 'u', 1, 'Devolución', 10);`);

      db.exec(migration('0024_credit_note_returns.sql'));
      db.exec(migration('0025_document_type_customization.sql'));

      expect(db.prepare("SELECT sale_id, amount FROM credit_notes WHERE id = 'cn'").get()).toMatchObject({ sale_id: 's', amount: 10 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_credit_notes_branch'").get()).toBeDefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_credit_notes_sale'").get()).toBeDefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credit_notes_old'").get()).toBeUndefined();
      db.exec(`INSERT INTO credit_notes (id, branch_id, user_id, sale_number, reason, amount)
        VALUES ('standalone', 'b', 'u', 2, 'Sin venta', 5);`);
      expect(db.prepare("SELECT sale_id FROM credit_notes WHERE id = 'standalone'").get()).toMatchObject({ sale_id: null });
    } finally {
      db.close();
    }
  });
});
