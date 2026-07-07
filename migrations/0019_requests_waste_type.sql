-- ============================================================================
-- MIGRATION 0019: Agregar tipo 'waste' + columna metadata a requests
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Migra el sistema legacy de "mermas" (baja de lotes por vencimiento/rotura)
-- al sistema real de Solicitudes. Requiere:
--   1) Ampliar el CHECK de `type` para incluir 'waste'.
--   2) Agregar columna `metadata TEXT` nullable (guarda batch_id, quantity,
--      reason, etc. de la merma en JSON).
--
-- SQLite no permite ALTER TABLE ADD CONSTRAINT ni modificar un CHECK existente,
-- por lo que se recrea la tabla siguiendo el mismo patrón auto-contenido usado
-- en 0016. La única FK entrante a `requests` es request_activity.request_id
-- (ON DELETE CASCADE) — por eso deshabilitamos foreign_keys durante la recreación
-- para que el DROP no arrastre las filas de audit trail.

-- Deshabilitar FK para que request_activity no sea afectada por CASCADE
-- durante la recreación de la tabla requests.
-- DROP previo hace la migración idempotente (re-ejecutable sin falla).
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS requests_v2;

-- 1. Crear tabla nueva: CHECK de type con 'waste' + columna metadata
CREATE TABLE requests_v2 (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  type        TEXT NOT NULL CHECK(type IN ('supply','production','delivery','task','maintenance','custom','waste')),
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

  -- NUEVO: payload estructurado (JSON) para tipos que lo necesitan.
  -- Para 'waste': { batch_id | client_batch_id, quantity, reason }.
  metadata TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copiar datos columna por columna. metadata queda NULL para filas viejas.
INSERT INTO requests_v2 (
  id, type, title, description, priority,
  created_by_user_id, created_by_role,
  assigned_role, assigned_user_id, branch_id,
  is_permanent, recurrence_days, recurrence_time,
  status,
  accepted_by_user_id, accepted_by_role, is_optional_acceptance, original_assigned_role,
  admin_note, rejection_reason, reassignment_note,
  cost_spent, time_started, time_completed, duration_minutes, incidents,
  metadata,
  created_at, updated_at
)
SELECT
  id, type, title, description, priority,
  created_by_user_id, created_by_role,
  assigned_role, assigned_user_id, branch_id,
  is_permanent, recurrence_days, recurrence_time,
  status,
  accepted_by_user_id, accepted_by_role, is_optional_acceptance, original_assigned_role,
  admin_note, rejection_reason, reassignment_note,
  cost_spent, time_started, time_completed, duration_minutes, incidents,
  NULL,
  created_at, updated_at
FROM requests;

-- 3. Borrar triggers y tabla vieja
DROP TRIGGER IF EXISTS trg_requests_version_insert;
DROP TRIGGER IF EXISTS trg_requests_version_update;
DROP TABLE requests;

-- 4. Renombrar
ALTER TABLE requests_v2 RENAME TO requests;

-- 5. Recrear índices (idénticos a 0015/0016)
CREATE INDEX IF NOT EXISTS idx_requests_status         ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_assigned_role  ON requests(assigned_role);
CREATE INDEX IF NOT EXISTS idx_requests_branch         ON requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_requests_created        ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_permanent      ON requests(is_permanent) WHERE is_permanent = 1;

-- 6. Recrear triggers de versionado (idénticos a 0015/0016)
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
