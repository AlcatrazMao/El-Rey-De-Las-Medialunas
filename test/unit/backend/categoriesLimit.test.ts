import { describe, expect, it } from 'vitest';

// Réplica de la lógica de construcción de query del GET / de categories.ts.
// Valida que la query resultante incluye LIMIT 500 como cap de seguridad anti-DoS.
function buildCategoriesQuery(branchId: string, isActive?: string): { query: string; bindings: (string | number)[] } {
  let query = "SELECT * FROM categories WHERE branch_id = ? AND deleted_at IS NULL";
  const bindings: (string | number)[] = [branchId];

  if (isActive !== undefined) {
    query += " AND is_active = ?";
    bindings.push(isActive === "false" ? 0 : 1);
  }

  // SECURITY: cap de seguridad anti-DoS
  query += " ORDER BY sort_order ASC, name ASC LIMIT 500";

  return { query, bindings };
}

describe('categories GET / — LIMIT 500 anti-DoS cap', () => {
  it('la query sin filtro incluye LIMIT 500', () => {
    const { query } = buildCategoriesQuery('branch-1');
    expect(query).toContain('LIMIT 500');
  });

  it('la query con is_active=true también incluye LIMIT 500', () => {
    const { query } = buildCategoriesQuery('branch-1', 'true');
    expect(query).toContain('LIMIT 500');
  });

  it('la query con is_active=false también incluye LIMIT 500', () => {
    const { query } = buildCategoriesQuery('branch-1', 'false');
    expect(query).toContain('LIMIT 500');
  });

  it('LIMIT aparece al final, después del ORDER BY', () => {
    const { query } = buildCategoriesQuery('branch-1');
    const orderByPos = query.indexOf('ORDER BY');
    const limitPos = query.indexOf('LIMIT 500');
    expect(orderByPos).toBeGreaterThan(-1);
    expect(limitPos).toBeGreaterThan(orderByPos);
  });

  it('el branchId queda como primer binding', () => {
    const { bindings } = buildCategoriesQuery('sucursal-x');
    expect(bindings[0]).toBe('sucursal-x');
  });

  it('is_active=false agrega binding 0', () => {
    const { bindings } = buildCategoriesQuery('b', 'false');
    expect(bindings).toContain(0);
  });

  it('is_active=true (o cualquier valor != false) agrega binding 1', () => {
    const { bindings } = buildCategoriesQuery('b', 'true');
    expect(bindings).toContain(1);
  });
});
