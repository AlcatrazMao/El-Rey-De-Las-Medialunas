import type { D1Database } from "@cloudflare/workers-types";

export async function resolveUser(db: D1Database, userId: string): Promise<{ id: string } | null> {
  // Filtramos deleted_at IS NULL para impedir que usuarios soft-deleted
  // sigan autenticando si quedó is_active = 1 por error.
  // IMPORTANTE: issueTokens firma el JWT con sub: user.id (ID interno hex-32).
  // El middleware copia ese sub a c.get("userId"). Debemos buscar por id, NO por firebase_uid.
  return db
    .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1")
    .bind(userId)
    .first<{ id: string }>();
}
