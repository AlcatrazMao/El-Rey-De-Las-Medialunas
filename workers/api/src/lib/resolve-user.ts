import type { D1Database } from "@cloudflare/workers-types";

export async function resolveUser(db: D1Database, firebaseUid: string): Promise<{ id: string } | null> {
  return db
    .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1")
    .bind(firebaseUid)
    .first<{ id: string }>();
}
