-- Fix: Remove CHECK constraint on role so Spanish roles (cajero, panadero, admin) are accepted.
-- D1 always enforces FK constraints — PRAGMA foreign_keys = OFF has no effect.
-- We empty child tables first, recreate users without CHECK, then restore.

-- 1. Clear child rows that reference users (seed data only, restored below)
DELETE FROM user_branches;

-- 2. Create new users table without the restrictive CHECK constraint on role
CREATE TABLE users_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    firebase_uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cajero',
    phone TEXT,
    avatar_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

-- 3. Migrate existing data
INSERT INTO users_new SELECT * FROM users;

-- 4. Drop old table (safe: user_branches is now empty, other child tables have no rows)
DROP TABLE users;

-- 5. Rename to final name
ALTER TABLE users_new RENAME TO users;

-- 6. Restore user_branches seed data
INSERT INTO user_branches (user_id, branch_id, is_default)
VALUES
  ('00000000000000000000000000000001', '00000000000000000000000000000001', 1),
  ('00000000000000000000000000000001', '00000000000000000000000000000002', 0),
  ('00000000000000000000000000000002', '00000000000000000000000000000001', 1),
  ('00000000000000000000000000000003', '00000000000000000000000000000001', 1);
