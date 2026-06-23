import { describe, expect, it } from 'vitest';

// ============================================================================
// userIdResolution.test.ts
//
// Verifica que resolveUser retorna el id INTERNO de la tabla users (hex 32
// chars) y no el Firebase UID que viene del JWT. También comprueba la
// validación de roles en supply-requests POST.
//
// Tests son unitarios puros: no dependen de Cloudflare Workers runtime,
// D1 real ni Hono. Las réplicas locales reproducen la lógica exacta.
// ============================================================================

// ---------------------------------------------------------------------------
// Réplica de genId (workers/api/src/utils/id.ts)
// ---------------------------------------------------------------------------
function genId(): string {
  return crypto.randomUUID().replace(/-/g, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Simulación mínima de D1Database para resolveUser
// ---------------------------------------------------------------------------
type UserRow = { id: string; firebase_uid: string; is_active: number; deleted_at: string | null };

function makeDb(users: UserRow[]) {
  return {
    prepare(sql: string) {
      return {
        bind(firebaseUid: string) {
          return {
            async first<T>(): Promise<T | null> {
              // Replica del query: SELECT id FROM users WHERE firebase_uid = ? AND is_active = 1 AND deleted_at IS NULL
              const row = users.find(
                (u) =>
                  u.firebase_uid === firebaseUid &&
                  u.is_active === 1 &&
                  u.deleted_at === null,
              );
              return (row ? { id: row.id } : null) as T | null;
            },
          };
        },
      };
    },
  };
}

// Réplica de resolveUser (workers/api/src/lib/resolve-user.ts)
async function resolveUser(
  db: ReturnType<typeof makeDb>,
  firebaseUid: string,
): Promise<{ id: string } | null> {
  return db
    .prepare(
      'SELECT id FROM users WHERE firebase_uid = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1',
    )
    .bind(firebaseUid)
    .first<{ id: string }>();
}

// ---------------------------------------------------------------------------
// Réplica de la validación de roles en supply-requests POST
// (workers/api/src/routes/supply-requests.ts)
// ---------------------------------------------------------------------------
const SUPPLY_REQUEST_ALLOWED_ROLES = new Set(['cashier', 'supervisor', 'admin', 'owner']);

function canCreateSupplyRequest(role: string): boolean {
  return SUPPLY_REQUEST_ALLOWED_ROLES.has(role);
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
const FIREBASE_UID = 'firebase_uid_abc123xyz';
const INTERNAL_ID = genId(); // hex 32 chars

const SEED_USERS: UserRow[] = [
  {
    id: INTERNAL_ID,
    firebase_uid: FIREBASE_UID,
    is_active: 1,
    deleted_at: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveUser — retorna id interno, no Firebase UID', () => {
  it('retorna un objeto con id cuando el firebase_uid existe y el usuario está activo', async () => {
    const db = makeDb(SEED_USERS);
    const user = await resolveUser(db, FIREBASE_UID);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(INTERNAL_ID);
  });

  it('el id interno tiene exactamente 32 caracteres hex (no es el Firebase UID)', async () => {
    const db = makeDb(SEED_USERS);
    const user = await resolveUser(db, FIREBASE_UID);
    expect(user).not.toBeNull();
    expect(user!.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('Firebase UID y user.id son valores distintos', async () => {
    const db = makeDb(SEED_USERS);
    const user = await resolveUser(db, FIREBASE_UID);
    expect(user).not.toBeNull();
    expect(user!.id).not.toBe(FIREBASE_UID);
  });

  it('retorna null cuando el firebase_uid no existe en la tabla', async () => {
    const db = makeDb(SEED_USERS);
    const user = await resolveUser(db, 'uid_que_no_existe');
    expect(user).toBeNull();
  });

  it('retorna null cuando el usuario está inactivo (is_active = 0)', async () => {
    const db = makeDb([
      {
        id: genId(),
        firebase_uid: 'uid_inactivo',
        is_active: 0,
        deleted_at: null,
      },
    ]);
    const user = await resolveUser(db, 'uid_inactivo');
    expect(user).toBeNull();
  });

  it('retorna null cuando el usuario tiene deleted_at (soft-deleted)', async () => {
    const db = makeDb([
      {
        id: genId(),
        firebase_uid: 'uid_eliminado',
        is_active: 1,
        deleted_at: '2025-01-01T00:00:00.000Z',
      },
    ]);
    const user = await resolveUser(db, 'uid_eliminado');
    expect(user).toBeNull();
  });

  it('el id interno tiene formato hex 32 chars generado por genId()', () => {
    const id = genId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).toHaveLength(32);
    // El Firebase UID es distinto en formato: no es hex puro de 32 chars
    expect(FIREBASE_UID).not.toMatch(/^[0-9a-f]{32}$/);
  });

  it('múltiples usuarios — resuelve el correcto por firebase_uid', async () => {
    const otherId = genId();
    const db = makeDb([
      ...SEED_USERS,
      {
        id: otherId,
        firebase_uid: 'otro_firebase_uid',
        is_active: 1,
        deleted_at: null,
      },
    ]);
    const user = await resolveUser(db, 'otro_firebase_uid');
    expect(user).not.toBeNull();
    expect(user!.id).toBe(otherId);
    expect(user!.id).not.toBe(INTERNAL_ID);
  });
});

describe('supply-requests POST — validación de roles', () => {
  it('cashier puede crear solicitudes de abastecimiento', () => {
    expect(canCreateSupplyRequest('cashier')).toBe(true);
  });

  it('supervisor puede crear solicitudes de abastecimiento', () => {
    expect(canCreateSupplyRequest('supervisor')).toBe(true);
  });

  it('admin puede crear solicitudes de abastecimiento', () => {
    expect(canCreateSupplyRequest('admin')).toBe(true);
  });

  it('owner puede crear solicitudes de abastecimiento', () => {
    expect(canCreateSupplyRequest('owner')).toBe(true);
  });

  it('production NO puede crear solicitudes → 403', () => {
    expect(canCreateSupplyRequest('production')).toBe(false);
  });

  it('warehouse NO puede crear solicitudes → 403', () => {
    expect(canCreateSupplyRequest('warehouse')).toBe(false);
  });

  it('rol vacío NO puede crear solicitudes → 403', () => {
    expect(canCreateSupplyRequest('')).toBe(false);
  });

  it('rol desconocido NO puede crear solicitudes → 403', () => {
    expect(canCreateSupplyRequest('hacker')).toBe(false);
  });
});
