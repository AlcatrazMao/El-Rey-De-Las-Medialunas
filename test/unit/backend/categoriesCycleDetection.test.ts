import { describe, expect, it } from 'vitest';

// Exact replica from workers/api/src/routes/categories.ts — wouldCreateCycle.
// El handler real usa D1; acá inyectamos un fake DB que sirve un Map id→parent_id
// para poder testear la lógica de recorrido sin tocar SQLite.
interface FakeDb {
  prepare(sql: string): {
    bind(id: string): {
      first<T>(): Promise<T | null>;
    };
  };
}

function makeDb(tree: Record<string, string | null>): FakeDb {
  return {
    prepare(_sql: string) {
      return {
        bind(id: string) {
          return {
            async first<T>(): Promise<T | null> {
              if (!(id in tree)) return null;
              const parent = tree[id] ?? null;
              return { parent_id: parent } as unknown as T;
            },
          };
        },
      };
    },
  };
}

async function wouldCreateCycle(
  db: FakeDb,
  categoryId: string,
  newParentId: string,
): Promise<boolean> {
  let currentId: string | null = newParentId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (currentId === categoryId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const row = await db
      .prepare('SELECT parent_id FROM categories WHERE id = ? AND deleted_at IS NULL')
      .bind(currentId)
      .first<{ parent_id: string | null }>();
    if (!row) break;
    currentId = row.parent_id;
  }
  return false;
}

describe('wouldCreateCycle (categories.ts)', () => {
  it('returns false when newParent has parent NULL (A → root)', async () => {
    const db = makeDb({ B: null });
    expect(await wouldCreateCycle(db, 'A', 'B')).toBe(false);
  });

  it('returns false in a clean chain A → B → null', async () => {
    const db = makeDb({ B: null });
    expect(await wouldCreateCycle(db, 'A', 'B')).toBe(false);
  });

  it('returns true for self-reference A → A', async () => {
    const db = makeDb({ A: null });
    expect(await wouldCreateCycle(db, 'A', 'A')).toBe(true);
  });

  it('returns true for indirect cycle A → B → A', async () => {
    // El parent_id propuesto es B; B apunta a A → ciclo.
    const db = makeDb({ B: 'A', A: null });
    expect(await wouldCreateCycle(db, 'A', 'B')).toBe(true);
  });

  it('returns false on a long chain without cycle (E → D → C → B → null)', async () => {
    const db = makeDb({ B: null, C: 'B', D: 'C', E: 'D' });
    expect(await wouldCreateCycle(db, 'A', 'E')).toBe(false);
  });

  it('returns true on a longer indirect cycle A → C → B → A', async () => {
    const db = makeDb({ C: 'B', B: 'A', A: null });
    expect(await wouldCreateCycle(db, 'A', 'C')).toBe(true);
  });

  it('returns true on a preexisting cycle in the DB (B → C → B)', async () => {
    // Aún si A no es parte del ciclo, queremos romper el loop infinito.
    const db = makeDb({ B: 'C', C: 'B' });
    expect(await wouldCreateCycle(db, 'A', 'B')).toBe(true);
  });

  it('returns false when newParent id is missing (deleted category)', async () => {
    // Caso: la categoría padre propuesta no existe; el while termina con break.
    const db = makeDb({});
    expect(await wouldCreateCycle(db, 'A', 'GHOST')).toBe(false);
  });
});
