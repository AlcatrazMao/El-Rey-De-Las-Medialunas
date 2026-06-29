-- ============================================================================
-- MIGRATION 0016: CHECK constraint en duration_minutes de requests
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- SQLite no permite ALTER TABLE ADD CONSTRAINT, por lo que se recreá la tabla.
-- El valor ya se garantiza >= 0 en la capa de aplicación (MAX(0, ...)),
-- este CHECK es una capa defensiva adicional.

-- Deshabilitar FK para que request_activity no sea afectada por CASCADE
-- durante la recreación de la tabla requests.
-- DROP previo hace la migración idempotente (re-ejecutable sin falla).
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS requests_v2;

-- 1. Crear tabla nueva con el CHECK en duration_minutes
CREATE TABLE requests_v2 (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  type        TEXT NOT NULL CHECK(type IN ('supply','production','delivery','task','maintenance','custom')),
  title       TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),

  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_role    TEXT NOT NULL,

  assigned_role    TEXT NOT NULL CHECK(assigned_role IN ('admin','cajero','cocinero','repartidor','panadero','all')),
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,

  is_permanent     INTEGER NOT NULL DEFAULT 0 CHECK(is_permanent IN (0,1)),
  recurrence_days  TEXT,
  recurrence_time  TEXT,

  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN (
    'pending_approval',
    'approved',
    'rejected',
    'accepted',
    'in_progress',
    'completed',
    'reassignment_requested',
    'cancelled'
  )),

  accepted_by_user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_by_role         TEXT,
  is_optional_acceptance   INTEGER NOT NULL DEFAULT 0 CHECK(is_optional_acceptance IN (0,1)),
  original_assigned_role   TEXT,

  admin_note         TEXT,
  rejection_reason   TEXT,
  reassignment_note  TEXT,

  cost_spent       REAL CHECK(cost_spent IS NULL OR (cost_spent >= 0 AND cost_spent <= 10000000)),
  time_started     TEXT,
  time_completed   TEXT,
  duration_minutes INTEGER CHECK(duration_minutes IS NULL OR duration_minutes >= 0),
  incidents        TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copiar todos los datos (MAX(0,...) para sanear eventuales negativos históricos)
INSERT INTO requests_v2
SELECT
  id, type, title, description, priority,
  created_by_user_id, created_by_role,
  assigned_role, assigned_user_id, branch_id,
  is_permanent, recurrence_days, recurrence_time,
  status,
  accepted_by_user_id, accepted_by_role, is_optional_acceptance, original_assigned_role,
  admin_note, rejection_reason, reassignment_note,
  cost_spent, time_started, time_completed,
  CASE WHEN duration_minutes IS NULL THEN NULL
       WHEN duration_minutes < 0 THEN 0
       ELSE duration_minutes
  END,
  incidents,
  created_at, updated_at
FROM requests;

-- 3. Borrar triggers y tabla vieja
DROP TRIGGER IF EXISTS trg_requests_version_insert;
DROP TRIGGER IF EXISTS trg_requests_version_update;
DROP TABLE requests;

-- 4. Renombrar
ALTER TABLE requests_v2 RENAME TO requests;

-- 5. Recrear índices
CREATE INDEX IF NOT EXISTS idx_requests_status         ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_assigned_role  ON requests(assigned_role);
CREATE INDEX IF NOT EXISTS idx_requests_branch         ON requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_requests_created        ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_permanent      ON requests(is_permanent) WHERE is_permanent = 1;

-- 6. Recrear triggers de versionado
CREATE TRIGGER IF NOT EXISTS trg_requests_version_insert
AFTER INSERT ON requests
BEGIN
  UPDATE data_versions
     SET version = version + 1, updated_at = datetime('now')
   WHERE key = 'requests';
END;

CREATE TRIGGER IF NOT EXISTS trg_requests_version_update
AFTER UPDATE ON requests
BEGIN
  UPDATE data_versions
     SET version = version + 1, updated_at = datetime('now')
   WHERE key = 'requests';
END;

-- Rehabilitar FK ahora que la tabla fue recreada correctamente.
PRAGMA foreign_keys = ON;
