-- ============================================================================
-- MIGRATION 0026: alinea los CHECK de caja con lo que el código realmente escribe
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Dos desajustes CHECK ↔ código que hoy revientan con error 500 en producción:
--
--   1. cash_sessions.status: el código escribe 'auto_closed' en DOS flujos
--      (apertura de caja que auto-cierra la sesión del día anterior, y cierre
--      con closing_amount = null), pero el CHECK solo permitía
--      ('open','closing','closed'). Todo auto-cierre lanzaba CHECK violation.
--
--   2. cash_movements.type: el API valida e inserta 'adjustment'
--      (VALID_MOVEMENT_TYPES = ['income','expense','adjustment']) y
--      computeMovementsDelta lo cuenta, pero el CHECK solo permitía
--      ('sale','expense','income','withdrawal'). Todo ajuste de caja lanzaba
--      CHECK violation.
--
-- En ambos casos SQLite no soporta ALTER TABLE ADD/DROP CONSTRAINT, por lo que
-- se recrean las tablas completas con el mismo patrón que 0017/0018/0022.
--
-- DECISIÓN (additive, no destructivo): se AGREGAN los valores faltantes sin
-- remover los legacy ('sale','withdrawal' en type). Si existiera alguna fila
-- histórica con esos tipos, copiarla con un CHECK más estricto haría fallar la
-- migración en producción. El API simplemente no los acepta, pero la DB no los
-- rechaza.
--
-- El DROP previo de cash_sessions_v2 / cash_movements_v2 hace la migración
-- idempotente.

PRAGMA foreign_keys = OFF;

-- ── 1. Recrear cash_sessions (agrega 'auto_closed' al CHECK de status) ─────
DROP TABLE IF EXISTS cash_sessions_v2;

CREATE TABLE cash_sessions_v2 (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    supervisor_id TEXT REFERENCES users(id),
    opening_amount REAL NOT NULL,
    closing_amount REAL,
    expected_amount REAL,
    difference REAL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closing','closed','auto_closed')),
    notes TEXT,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
);

-- Copiar todos los datos (columna por columna, orden explícito)
INSERT INTO cash_sessions_v2 (
    id, branch_id, user_id, supervisor_id,
    opening_amount, closing_amount, expected_amount, difference,
    status, notes, opened_at, closed_at
)
SELECT
    id, branch_id, user_id, supervisor_id,
    opening_amount, closing_amount, expected_amount, difference,
    status, notes, opened_at, closed_at
FROM cash_sessions;

-- Borrar tabla vieja
DROP TABLE cash_sessions;

-- Renombrar
ALTER TABLE cash_sessions_v2 RENAME TO cash_sessions;

-- Recrear índices
CREATE INDEX IF NOT EXISTS idx_cash_sessions_branch ON cash_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_user   ON cash_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);

-- ── 2. Recrear cash_movements (agrega 'adjustment' al CHECK de type) ───────
DROP TABLE IF EXISTS cash_movements_v2;

CREATE TABLE cash_movements_v2 (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('sale','expense','income','withdrawal','adjustment')),
    amount REAL NOT NULL,
    description TEXT,
    category TEXT,
    receipt_image_url TEXT,
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copiar todos los datos (columna por columna, orden explícito)
INSERT INTO cash_movements_v2 (
    id, cash_session_id, user_id, type, amount,
    description, category, receipt_image_url, reference_id, created_at
)
SELECT
    id, cash_session_id, user_id, type, amount,
    description, category, receipt_image_url, reference_id, created_at
FROM cash_movements;

-- Borrar tabla vieja
DROP TABLE cash_movements;

-- Renombrar
ALTER TABLE cash_movements_v2 RENAME TO cash_movements;

-- Recrear índices
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_type    ON cash_movements(type);
CREATE INDEX IF NOT EXISTS idx_cash_movements_date    ON cash_movements(created_at);

PRAGMA foreign_keys = ON;
