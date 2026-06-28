-- ============================================================================
-- MIGRATION 0015: Sistema unificado de solicitudes (requests)
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Workflow multi-rol con aprobación, aceptación opcional y métricas de cierre.
-- Reemplaza/extiende el concepto de supply_requests con un modelo polimórfico
-- que cubre supply, production, delivery, task, maintenance y custom.
--
-- Incluye tabla data_versions para coordinar refetch del frontend (compara
-- version local vs remota antes de invalidar cache).

-- ----------------------------------------------------------------------------
-- TABLE: data_versions
-- Versioning para que el frontend compare antes de refetch.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_versions (
  key        TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed inicial de versiones
INSERT OR IGNORE INTO data_versions (key, version) VALUES
  ('requests', 1),
  ('tasks', 1);

-- ----------------------------------------------------------------------------
-- TABLE: requests
-- Solicitud unificada (supply, production, delivery, task, maintenance, custom)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  -- Tipo y contenido
  type        TEXT NOT NULL CHECK(type IN ('supply','production','delivery','task','maintenance','custom')),
  title       TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),

  -- Creación
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_role    TEXT NOT NULL,

  -- Asignación primaria
  assigned_role    TEXT NOT NULL CHECK(assigned_role IN ('admin','cajero','cocinero','repartidor','panadero','all')),
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- Branch vinculada (para supply, production, delivery)
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,

  -- Recurrencia (tareas permanentes)
  is_permanent     INTEGER NOT NULL DEFAULT 0 CHECK(is_permanent IN (0,1)),
  recurrence_days  TEXT, -- JSON: [0,1,2,3,4,5,6] (0=Dom)
  recurrence_time  TEXT, -- HH:MM

  -- Estado (máquina de estados)
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

  -- Aceptación (puede ser el rol asignado u otro rol vía Opcionales)
  accepted_by_user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_by_role         TEXT,
  is_optional_acceptance   INTEGER NOT NULL DEFAULT 0 CHECK(is_optional_acceptance IN (0,1)),
  original_assigned_role   TEXT, -- guardado cuando se acepta opcionalmente

  -- Admin memo
  admin_note         TEXT,
  rejection_reason   TEXT,
  reassignment_note  TEXT,

  -- Métricas de cierre (cargadas por quien completa)
  cost_spent       REAL CHECK(cost_spent IS NULL OR (cost_spent >= 0 AND cost_spent <= 10000000)),
  time_started     TEXT, -- ISO timestamp
  time_completed   TEXT, -- ISO timestamp
  duration_minutes INTEGER, -- calculado al cerrar: ROUND((julianday(time_completed) - julianday(time_started)) * 1440)
  incidents        TEXT, -- descripción de incidentes

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_requests_status         ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_assigned_role  ON requests(assigned_role);
CREATE INDEX IF NOT EXISTS idx_requests_branch         ON requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_requests_created        ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_permanent      ON requests(is_permanent) WHERE is_permanent = 1;

-- ----------------------------------------------------------------------------
-- TABLE: request_activity
-- Log de actividad por solicitud (audit trail)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_activity (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_role  TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL CHECK(action IN (
    'created','approved','rejected','accepted',
    'accepted_optional','started','completed',
    'reassignment_requested','reassignment_approved',
    'cancelled','comment','edited'
  )),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_request_activity_request
  ON request_activity(request_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- TRIGGERS: bump data_versions.version cuando cambia requests
-- Permite al frontend detectar cambios sin polling pesado.
-- ----------------------------------------------------------------------------
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
