import type { D1Database } from "@cloudflare/workers-types";
import type { Role } from "@medialunas/shared";

export interface ResolvedUserBranch {
  branch_id: string;
  is_default: boolean;
}

export interface ResolvedUser {
  id: string;
  role: Role;
  branches: ResolvedUserBranch[];
  default_branch: string | null;
}

interface UserBranchRow {
  user_id: string;
  role: string;
  branch_id: string | null;
  is_default: number | null;
}

// Devuelve el usuario autenticado con su rol y sus sucursales (via JOIN con
// user_branches), incluyendo cuál es la sucursal default (is_default = 1).
// NOTA: la mayoría de los callers existentes solo destructuran `{ id }` de
// esta función — agregar campos acá es un cambio de superset, no rompe esos
// call sites.
export async function resolveUser(db: D1Database, userId: string): Promise<ResolvedUser | null> {
  // Filtramos deleted_at IS NULL para impedir que usuarios soft-deleted
  // sigan autenticando si quedó is_active = 1 por error.
  // IMPORTANTE: issueTokens firma el JWT con sub: user.id (ID interno hex-32).
  // El middleware copia ese sub a c.get("userId"). Debemos buscar por id, NO por firebase_uid.
  const rows = await db
    .prepare(
      `SELECT u.id AS user_id, u.role AS role, ub.branch_id AS branch_id, ub.is_default AS is_default
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       WHERE u.id = ? AND u.is_active = 1 AND u.deleted_at IS NULL`,
    )
    .bind(userId)
    .all<UserBranchRow>();

  const result = rows.results ?? [];
  if (result.length === 0) return null;

  const first = result[0]!;
  const branches: ResolvedUserBranch[] = result
    .filter((r): r is UserBranchRow & { branch_id: string } => r.branch_id !== null)
    .map((r) => ({ branch_id: r.branch_id, is_default: r.is_default === 1 }));

  const defaultBranch = branches.find((b) => b.is_default)?.branch_id ?? null;

  return {
    id: first.user_id,
    role: first.role as Role,
    branches,
    default_branch: defaultBranch,
  };
}
