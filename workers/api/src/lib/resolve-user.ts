import type { D1Database } from "@cloudflare/workers-types";

export async function resolveUser(db: D1Database, firebaseUid: string): Promise<{ id: string } | null> {
  // Filtramos deleted_at IS NULL para impedir que usuarios soft-deleted
  // sigan autenticando si quedó is_active = 1 por error.
  return db
    .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1")
    .bind(firebaseUid)
    .first<{ id: string }>();
}
