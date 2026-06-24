import { describe, expect, it } from 'vitest';

import { escapeLike } from '../../../workers/api/src/lib/sql-escape';

// ── Fix 1 & 2: escapeLikeInQuery ────────────────────────────────────────────
// Verifica que escapeLike produce la cadena correcta para usarla con LIKE ?
// ESCAPE '\' en SQLite/D1 (producción GET /recipes y audit GET / action filter).

describe('escapeLikeInQuery — production.ts / audit.ts', () => {
  it('escapa % en el input para evitar wildcard no intencional', () => {
    const input = '50%';
    const like = `%${escapeLike(input)}%`;
    expect(like).toBe('%50\\%%');
  });

  it('escapa _ en el input para evitar single-char wildcard', () => {
    const input = 'pan_dulce';
    const like = `%${escapeLike(input)}%`;
    expect(like).toBe('%pan\\_dulce%');
  });

  it('escapa backslash duplicándolo antes de los wildcards', () => {
    const input = 'path\\file';
    const like = `%${escapeLike(input)}%`;
    expect(like).toBe('%path\\\\file%');
  });

  it('deja texto plano sin cambios entre los %%', () => {
    const input = 'medialunas';
    const like = `%${escapeLike(input)}%`;
    expect(like).toBe('%medialunas%');
  });

  it('cadena con % y _ combinados queda completamente escapada', () => {
    const input = '50%_off';
    const like = `%${escapeLike(input)}%`;
    expect(like).toBe('%50\\%\\_off%');
  });

  it('cadena vacía produce %%', () => {
    const like = `%${escapeLike('')}%`;
    expect(like).toBe('%%');
  });
});

// ── Fix 3: canCreateProductInBranch ─────────────────────────────────────────
// Replica la lógica de autorización del POST / en products.ts:
//   admin y owner pueden crear productos en cualquier sucursal.
//   supervisor solo puede crear en su propia sucursal (jwtBranchId).

function canCreateProductInBranch(
  userRole: string,
  targetBranchId: string,
  jwtBranchId: string | undefined,
): boolean {
  if (userRole === 'admin' || userRole === 'owner') return true;
  return targetBranchId === jwtBranchId;
}

describe('canCreateProductInBranch — products.ts POST /', () => {
  it('admin puede crear en cualquier sucursal', () => {
    expect(canCreateProductInBranch('admin', 'branch-B', 'branch-A')).toBe(true);
  });

  it('owner puede crear en cualquier sucursal', () => {
    expect(canCreateProductInBranch('owner', 'branch-X', 'branch-Y')).toBe(true);
  });

  it('supervisor puede crear en su propia sucursal', () => {
    expect(canCreateProductInBranch('supervisor', 'branch-A', 'branch-A')).toBe(true);
  });

  it('supervisor NO puede crear en otra sucursal', () => {
    expect(canCreateProductInBranch('supervisor', 'branch-B', 'branch-A')).toBe(false);
  });

  it('cashier NO puede crear en otra sucursal', () => {
    expect(canCreateProductInBranch('cashier', 'branch-B', 'branch-A')).toBe(false);
  });

  it('cashier puede crear en su propia sucursal', () => {
    expect(canCreateProductInBranch('cashier', 'branch-A', 'branch-A')).toBe(true);
  });

  it('jwtBranchId undefined → no puede crear en ninguna sucursal (no admin/owner)', () => {
    expect(canCreateProductInBranch('supervisor', 'branch-A', undefined)).toBe(false);
  });
});

// ── Fix 5: wouldCreateCycle con cap de profundidad ───────────────────────────
// Replica la lógica de categories.ts wouldCreateCycle con el nuevo cap a 100.
// El fake DB genera una cadena de N nodos (C0 → C1 → C2 → … → null).

interface FakeDb {
  prepare(sql: string): {
    bind(id: string): {
      first<T>(): Promise<T | null>;
    };
  };
}

function makeChainDb(depth: number): FakeDb {
  // Genera un árbol lineal: C0→C1→C2→…→C(depth-1)→null
  const tree: Record<string, string | null> = {};
  for (let i = 0; i < depth; i++) {
    tree[`C${i}`] = i + 1 < depth ? `C${i + 1}` : null;
  }
  return {
    prepare(_sql: string) {
      return {
        bind(id: string) {
          return {
            async first<T>(): Promise<T | null> {
              if (!(id in tree)) return null;
              return { parent_id: tree[id] } as unknown as T;
            },
          };
        },
      };
    },
  };
}

async function wouldCreateCycleWithCap(
  db: FakeDb,
  categoryId: string,
  newParentId: string,
): Promise<boolean> {
  let currentId: string | null = newParentId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (currentId === categoryId) return true;
    if (visited.has(currentId)) return true;
    if (visited.size >= 100) return true; // cap
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

describe('wouldCreateCycleWithCap — categories.ts depth cap', () => {
  it('cadena corta (10 nodos) sin ciclo retorna false', async () => {
    const db = makeChainDb(10);
    // categoryId = 'GHOST' no está en el árbol; recorremos sin ciclo
    expect(await wouldCreateCycleWithCap(db, 'GHOST', 'C0')).toBe(false);
  });

  it('cadena de 100 nodos sin ciclo retorna false (justo bajo el cap)', async () => {
    // Con 100 nodos (C0…C99), visited.size llega a 99 antes del check → no activa cap.
    const db = makeChainDb(100);
    expect(await wouldCreateCycleWithCap(db, 'GHOST', 'C0')).toBe(false);
  });

  it('cadena de 101 nodos activa el cap y retorna true para evitar loop infinito', async () => {
    // Con 101 nodos (C0…C100), en la iteración 101 visited.size=100 ≥ 100 → cap activo.
    const db = makeChainDb(101);
    expect(await wouldCreateCycleWithCap(db, 'GHOST', 'C0')).toBe(true);
  });

  it('cadena de 200 nodos también activa el cap y retorna true', async () => {
    const db = makeChainDb(200);
    expect(await wouldCreateCycleWithCap(db, 'GHOST', 'C0')).toBe(true);
  });

  it('cadena de 200 nodos activa el cap y retorna true', async () => {
    const db = makeChainDb(200);
    expect(await wouldCreateCycleWithCap(db, 'GHOST', 'C0')).toBe(true);
  });

  it('ciclo real de 2 nodos (A→B→A) sigue detectado correctamente', async () => {
    const db: FakeDb = {
      prepare(_sql: string) {
        return {
          bind(id: string) {
            return {
              async first<T>(): Promise<T | null> {
                const tree: Record<string, string | null> = { B: 'A', A: null };
                if (!(id in tree)) return null;
                return { parent_id: tree[id] } as unknown as T;
              },
            };
          },
        };
      },
    };
    expect(await wouldCreateCycleWithCap(db, 'A', 'B')).toBe(true);
  });
});
