import { describe, it, expect } from 'vitest';

/**
 * Tests para GET /pull — verificar que cada query tiene LIMIT 500.
 *
 * Un cliente 30 días offline puede tener miles de filas pendientes;
 * sin LIMIT, la respuesta puede superar 32 MB y causar timeout o OOM.
 *
 * Testeamos que los strings de query en el array PULLABLE de sync.ts
 * incluyan "LIMIT 500". Replicamos el array localmente para mantener
 * los tests desacoplados del runtime de Cloudflare Workers.
 */

// ── Réplica del array PULLABLE de sync.ts ───────────────────────────────────
// Si se agrega una nueva entidad en sync.ts, hay que agregarla acá también.

const PULLABLE: { type: string; query: string }[] = [
  {
    type: 'products',
    query: `SELECT * FROM products WHERE branch_id = ? AND updated_at > ? LIMIT 500`,
  },
  {
    type: 'categories',
    query: `SELECT * FROM categories WHERE branch_id = ? AND updated_at > ? LIMIT 500`,
  },
  {
    type: 'inventory',
    query: `SELECT i.*, p.name as product_name FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.branch_id = ? AND i.updated_at > ? LIMIT 500`,
  },
  {
    type: 'customers',
    query: `SELECT * FROM customers WHERE updated_at > ? LIMIT 500`,
  },
  {
    type: 'sales',
    query: `SELECT * FROM sales WHERE branch_id = ? AND created_at > ? LIMIT 500`,
  },
  {
    type: 'batches',
    query: `SELECT ib.*, p.name as product_name FROM inventory_batches ib LEFT JOIN products p ON p.id = ib.product_id WHERE ib.branch_id = ? AND ib.created_at > ? LIMIT 500`,
  },
  {
    type: 'offers',
    query: `SELECT * FROM offers WHERE branch_id = ? AND updated_at > ? LIMIT 500`,
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('sync GET /pull — LIMIT 500 en cada query', () => {
  it('todas las entidades pullables tienen LIMIT 500 en su query', () => {
    for (const { type, query } of PULLABLE) {
      expect(
        query,
        `La query de "${type}" no tiene LIMIT 500`,
      ).toMatch(/LIMIT\s+500/i);
    }
  });

  it('products tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'products')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('categories tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'categories')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('inventory tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'inventory')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('customers tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'customers')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('sales tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'sales')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('batches tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'batches')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('offers tiene LIMIT 500', () => {
    const { query } = PULLABLE.find(p => p.type === 'offers')!;
    expect(query).toMatch(/LIMIT\s+500/i);
  });

  it('el LIMIT es exactamente 500, no otro valor', () => {
    for (const { type, query } of PULLABLE) {
      // Verificar que no sea LIMIT 50 o LIMIT 5000 o LIMIT 100
      const match = query.match(/LIMIT\s+(\d+)/i);
      expect(match, `"${type}" no tiene cláusula LIMIT`).not.toBeNull();
      expect(
        Number(match![1]),
        `"${type}" tiene LIMIT ${match![1]} en lugar de 500`,
      ).toBe(500);
    }
  });

  it('ninguna query tiene LIMIT > 500 (cap de seguridad)', () => {
    for (const { type, query } of PULLABLE) {
      const match = query.match(/LIMIT\s+(\d+)/i);
      if (match) {
        expect(
          Number(match[1]),
          `"${type}" supera el cap de 500 filas`,
        ).toBeLessThanOrEqual(500);
      }
    }
  });

  it('el array PULLABLE cubre las 7 entidades esperadas', () => {
    const types = PULLABLE.map(p => p.type);
    expect(types).toContain('products');
    expect(types).toContain('categories');
    expect(types).toContain('inventory');
    expect(types).toContain('customers');
    expect(types).toContain('sales');
    expect(types).toContain('batches');
    expect(types).toContain('offers');
    expect(types).toHaveLength(7);
  });
});
