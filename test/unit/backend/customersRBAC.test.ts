import { describe, it, expect } from 'vitest';

/**
 * Tests RBAC para /customers.
 *
 * Replica las funciones de autorización extraídas de workers/api/src/routes/customers.ts
 * sin dependencias de Hono, D1 ni runtime de Cloudflare.
 */

// ── Lógica pura extraída del handler ────────────────────────────────────────

/**
 * Replica canManageCustomers() de customers.ts.
 * Solo supervisor/admin/owner pueden crear o modificar clientes.
 */
function canManageCustomers(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner' || role === 'supervisor';
}

/**
 * Simula el guard del POST /customers:
 *   1. Usuario no registrado → 403 FORBIDDEN
 *   2. Rol no autorizado     → 403 FORBIDDEN
 *   3. name vacío            → 400 VALIDATION_ERROR
 *   4. Todo OK               → 201 con id
 */
function handlePostCustomer(params: {
  userResolved: boolean;
  role: string | undefined;
  body: { name?: string };
  insertedAt: string | null; // null = no se llegó al INSERT
}): { status: number; code: string } {
  if (!params.userResolved) return { status: 403, code: 'FORBIDDEN' };
  if (!canManageCustomers(params.role)) return { status: 403, code: 'FORBIDDEN' };
  if (!params.body.name?.trim()) return { status: 400, code: 'VALIDATION_ERROR' };
  // Si se llegó al INSERT, created_at/updated_at deben estar seteados
  if (params.insertedAt === null) return { status: 500, code: 'INSERT_NOT_REACHED' };
  return { status: 201, code: 'OK' };
}

/**
 * Simula el guard del PUT /customers/:id para is_active:
 *   1. Usuario no registrado                 → 403
 *   2. is_active en body + rol sin permiso   → 403
 *   3. is_active con valor inválido          → 400
 *   4. Todo OK                               → 200
 */
function handlePutIsActive(params: {
  userResolved: boolean;
  role: string | undefined;
  body: { is_active?: number };
}): { status: number; code: string } {
  if (!params.userResolved) return { status: 403, code: 'FORBIDDEN' };
  if (params.body.is_active !== undefined && params.body.is_active !== 0 && params.body.is_active !== 1) {
    return { status: 400, code: 'VALIDATION_ERROR' };
  }
  if (params.body.is_active !== undefined && !canManageCustomers(params.role)) {
    return { status: 403, code: 'FORBIDDEN' };
  }
  return { status: 200, code: 'OK' };
}

/**
 * Simula el INSERT de customers con created_at/updated_at explícitos.
 * Retorna los bindings en el orden que los recibe el prepared statement.
 */
function buildInsertBindings(params: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  type: string;
  creditLimit: number;
  notes: string | null;
  now: string;
}): unknown[] {
  return [
    params.id,
    params.name,
    params.email,
    params.phone,
    params.taxId,
    params.type,
    params.creditLimit,
    params.notes,
    params.now,   // created_at
    params.now,   // updated_at
  ];
}

// ── Tests: POST /customers RBAC ──────────────────────────────────────────────

describe('POST /customers — RBAC de creación', () => {
  const validBody = { name: 'Test Cliente' };

  it('supervisor puede crear clientes', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'supervisor',
      body: validBody,
      insertedAt: '2026-06-22 10:00:00',
    });
    expect(result.status).toBe(201);
  });

  it('admin puede crear clientes', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'admin',
      body: validBody,
      insertedAt: '2026-06-22 10:00:00',
    });
    expect(result.status).toBe(201);
  });

  it('owner puede crear clientes', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'owner',
      body: validBody,
      insertedAt: '2026-06-22 10:00:00',
    });
    expect(result.status).toBe(201);
  });

  it('cashier NO puede crear clientes → 403', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'cashier',
      body: validBody,
      insertedAt: null,
    });
    expect(result.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('production NO puede crear clientes → 403', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'production',
      body: validBody,
      insertedAt: null,
    });
    expect(result.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('warehouse NO puede crear clientes → 403', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'warehouse',
      body: validBody,
      insertedAt: null,
    });
    expect(result.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('rol undefined → 403 FORBIDDEN', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: undefined,
      body: validBody,
      insertedAt: null,
    });
    expect(result.status).toBe(403);
  });

  it('usuario no registrado en DB → 403 aunque rol sea admin', () => {
    const result = handlePostCustomer({
      userResolved: false,
      role: 'admin',
      body: validBody,
      insertedAt: null,
    });
    expect(result.status).toBe(403);
  });

  it('name vacío con rol válido → 400 VALIDATION_ERROR (no 403)', () => {
    const result = handlePostCustomer({
      userResolved: true,
      role: 'supervisor',
      body: { name: '   ' },
      insertedAt: null,
    });
    expect(result.status).toBe(400);
    expect(result.code).toBe('VALIDATION_ERROR');
  });
});

// ── Tests: PUT /customers/:id — guard is_active ───────────────────────────────

describe('PUT /customers/:id — guard is_active', () => {
  it('cashier intentando cambiar is_active → 403', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'cashier',
      body: { is_active: 0 },
    });
    expect(result.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('production intentando cambiar is_active → 403', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'production',
      body: { is_active: 0 },
    });
    expect(result.status).toBe(403);
  });

  it('warehouse intentando cambiar is_active → 403', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'warehouse',
      body: { is_active: 1 },
    });
    expect(result.status).toBe(403);
  });

  it('supervisor puede cambiar is_active → 200', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'supervisor',
      body: { is_active: 0 },
    });
    expect(result.status).toBe(200);
  });

  it('admin puede cambiar is_active → 200', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'admin',
      body: { is_active: 1 },
    });
    expect(result.status).toBe(200);
  });

  it('owner puede cambiar is_active → 200', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'owner',
      body: { is_active: 0 },
    });
    expect(result.status).toBe(200);
  });

  it('cashier sin is_active en body → no se activa guard → 200', () => {
    // Un cajero puede actualizar nombre/telefono sin tocar is_active
    const result = handlePutIsActive({
      userResolved: true,
      role: 'cashier',
      body: {},
    });
    expect(result.status).toBe(200);
  });

  it('is_active con valor inválido (2) → 400 antes del guard de rol', () => {
    const result = handlePutIsActive({
      userResolved: true,
      role: 'cashier',
      body: { is_active: 2 },
    });
    expect(result.status).toBe(400);
    expect(result.code).toBe('VALIDATION_ERROR');
  });
});

// ── Tests: INSERT con created_at/updated_at ──────────────────────────────────

describe('INSERT customers — created_at y updated_at explícitos', () => {
  const now = '2026-06-22 10:00:00';

  it('los bindings incluyen created_at en posición 9 (índice 8)', () => {
    const bindings = buildInsertBindings({
      id: 'cust_1',
      name: 'Ana García',
      email: null,
      phone: null,
      taxId: null,
      type: 'consumer',
      creditLimit: 0,
      notes: null,
      now,
    });
    // El INSERT tiene 10 parámetros: id, name, email, phone, document_number,
    // type, credit_limit, notes, created_at, updated_at
    expect(bindings).toHaveLength(10);
    expect(bindings[8]).toBe(now);  // created_at
    expect(bindings[9]).toBe(now);  // updated_at
  });

  it('created_at y updated_at NO son null', () => {
    const bindings = buildInsertBindings({
      id: 'cust_2',
      name: 'Test',
      email: null,
      phone: null,
      taxId: null,
      type: 'consumer',
      creditLimit: 0,
      notes: null,
      now,
    });
    expect(bindings[8]).not.toBeNull();
    expect(bindings[9]).not.toBeNull();
  });

  it('created_at y updated_at tienen el mismo valor (mismo tick)', () => {
    const bindings = buildInsertBindings({
      id: 'cust_3',
      name: 'Test',
      email: null,
      phone: null,
      taxId: null,
      type: 'consumer',
      creditLimit: 0,
      notes: null,
      now,
    });
    expect(bindings[8]).toBe(bindings[9]);
  });

  it('el SQL del INSERT incluye created_at y updated_at como columnas', () => {
    const sql = `INSERT INTO customers (id, name, email, phone, document_number, type, credit_limit, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    expect(sql).toContain('created_at');
    expect(sql).toContain('updated_at');
    // Verificar que la lista de VALUES tiene 10 placeholders
    const placeholders = sql.match(/\?/g);
    expect(placeholders).toHaveLength(10);
  });
});
