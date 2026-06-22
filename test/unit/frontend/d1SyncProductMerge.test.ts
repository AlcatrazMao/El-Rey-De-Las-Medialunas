import { describe, it, expect } from 'vitest';

// Replica de la lógica de merge en
// apps/pos-pc/src/services/d1-sync.ts → fetchProductsFromD1.
// Reglas:
//   - producto en D1 y en local → gana la versión D1 (campos sobrescritos)
//   - producto sólo en D1 → se agrega al resultado
//   - producto sólo en local (no sincronizado) → se MANTIENE
//   - el orden conserva primero los locales, luego los nuevos D1
//
// Tipamos un Product reducido para no acoplar el test al type real (que es
// más amplio); el merge sólo toca campos específicos.
interface LocalProduct {
  id: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  code: string;
  category: string;
  image?: string;
  ingredients?: unknown[];
}

interface D1ProductRow {
  id?: string;
  name?: string;
  price?: number;
  cost?: number;
  min_stock?: number;
  code?: string;
  category_id?: string;
}

function mergeProducts(existing: LocalProduct[], d1Products: D1ProductRow[]): LocalProduct[] {
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const merged: LocalProduct[] = [...existing];
  const seenIds = new Set(existing.map((p) => p.id));

  for (const d1 of d1Products) {
    const id = String(d1.id ?? '');
    if (!id) continue;

    if (existingById.has(id)) {
      const local = existingById.get(id)!;
      const idx = merged.findIndex((p) => p.id === id);
      merged[idx] = {
        ...local,
        name: String(d1.name ?? local.name),
        price: Number(d1.price ?? local.price),
        cost: Number(d1.cost ?? local.cost),
        minStock: Number(d1.min_stock ?? local.minStock),
        code: String(d1.code ?? local.code),
        category: local.category, // simplificado para test
      };
    } else if (!seenIds.has(id)) {
      seenIds.add(id);
      merged.push({
        id,
        name: String(d1.name ?? ''),
        category: 'panes',
        price: Number(d1.price ?? 0),
        cost: Number(d1.cost ?? 0),
        stock: 0,
        minStock: Number(d1.min_stock ?? 5),
        image: '🥐',
        code: String(d1.code ?? ''),
        ingredients: [],
      });
    }
  }

  // Bug fix mantenido: no descartar productos que sólo viven en local porque
  // su sync a D1 está pendiente.
  const d1Ids = new Set(d1Products.map((p) => String(p.id ?? '')));
  const existingIds = new Set(existing.map((p) => p.id));
  return merged.filter((p) => d1Ids.has(p.id) || existingIds.has(p.id));
}

const baseLocal = (overrides: Partial<LocalProduct> = {}): LocalProduct => ({
  id: 'p1',
  name: 'Local Original',
  price: 100,
  cost: 50,
  stock: 10,
  minStock: 5,
  code: 'LOC1',
  category: 'panes',
  ...overrides,
});

describe('fetchProductsFromD1 merge (d1-sync)', () => {
  it('producto en D1 y en local → gana la versión D1', () => {
    const existing = [baseLocal({ id: 'p1', name: 'Local Original', price: 100 })];
    const d1: D1ProductRow[] = [{ id: 'p1', name: 'D1 Wins', price: 200, cost: 75, min_stock: 8, code: 'D1-1' }];

    const result = mergeProducts(existing, d1);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('D1 Wins');
    expect(result[0].price).toBe(200);
    expect(result[0].cost).toBe(75);
    expect(result[0].minStock).toBe(8);
    expect(result[0].code).toBe('D1-1');
    // Stock local se preserva (D1 no lo dicta — viene de batches/local).
    expect(result[0].stock).toBe(10);
  });

  it('producto sólo en D1 → se agrega al resultado', () => {
    const existing: LocalProduct[] = [];
    const d1: D1ProductRow[] = [{ id: 'new-from-d1', name: 'Solo D1', price: 50, code: 'X' }];

    const result = mergeProducts(existing, d1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new-from-d1');
    expect(result[0].name).toBe('Solo D1');
    expect(result[0].price).toBe(50);
  });

  it('producto sólo en local (no sincronizado) → se MANTIENE (fix del bug)', () => {
    const existing = [baseLocal({ id: 'pending-sync', name: 'Pending Local' })];
    const d1: D1ProductRow[] = []; // D1 no lo conoce todavía

    const result = mergeProducts(existing, d1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pending-sync');
    expect(result[0].name).toBe('Pending Local');
  });

  it('producto en ambos con mismo id → usa versión D1', () => {
    const existing = [baseLocal({ id: 'shared', name: 'Local Name', price: 99 })];
    const d1: D1ProductRow[] = [{ id: 'shared', name: 'D1 Name', price: 199 }];

    const result = mergeProducts(existing, d1);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('D1 Name');
    expect(result[0].price).toBe(199);
  });

  it('combinación: mezcla local-only + D1-only + ambos', () => {
    const existing = [
      baseLocal({ id: 'only-local', name: 'Only Local' }),
      baseLocal({ id: 'both', name: 'Local Both', price: 100 }),
    ];
    const d1: D1ProductRow[] = [
      { id: 'both', name: 'D1 Both', price: 250 },
      { id: 'only-d1', name: 'Only D1', price: 333 },
    ];

    const result = mergeProducts(existing, d1);
    expect(result).toHaveLength(3);

    const byId = Object.fromEntries(result.map((p) => [p.id, p]));
    expect(byId['only-local'].name).toBe('Only Local');
    expect(byId['both'].name).toBe('D1 Both');
    expect(byId['both'].price).toBe(250);
    expect(byId['only-d1'].name).toBe('Only D1');
    expect(byId['only-d1'].price).toBe(333);
  });

  it('ignora rows de D1 sin id', () => {
    const existing = [baseLocal({ id: 'p1', name: 'Local' })];
    const d1: D1ProductRow[] = [{ name: 'sin id', price: 1 }];

    const result = mergeProducts(existing, d1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });
});
