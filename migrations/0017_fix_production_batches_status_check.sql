-- ============================================================================
-- MIGRATION 0017: agrega 'partial' al CHECK de production_batches.status
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- El endpoint POST /batches/:id/complete setea status='partial' cuando
-- actual_quantity < planned_quantity (ver production.ts ~L521), pero el CHECK
-- original solo permitía ('planned','in_progress','completed','cancelled').
-- SQLite no soporta ALTER TABLE ADD/DROP CONSTRAINT, por lo que se recrea la
-- tabla completa. Incluye consumed_snapshot (agregada en 0013).
--
-- El DROP previo de production_batches_v2 hace la migración idempotente.

PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS production_batches_v2;

-- 1. Crear tabla nueva con el CHECK ampliado (agrega 'partial')
CREATE TABLE production_batches_v2 (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    recipe_id TEXT NOT NULL REFERENCES production_recipes(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    planned_quantity REAL NOT NULL,
    actual_quantity REAL,
    waste_quantity REAL,
    total_cost REAL,
    unit_cost REAL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','partial','cancelled')),
    notes TEXT,
    planned_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    consumed_snapshot TEXT
);

-- 2. Copiar todos los datos (columna por columna, orden explícito)
INSERT INTO production_batches_v2 (
    id, recipe_id, branch_id, user_id,
    planned_quantity, actual_quantity, waste_quantity,
    total_cost, unit_cost, status, notes,
    planned_at, started_at, completed_at, consumed_snapshot
)
SELECT
    id, recipe_id, branch_id, user_id,
    planned_quantity, actual_quantity, waste_quantity,
    total_cost, unit_cost, status, notes,
    planned_at, started_at, completed_at, consumed_snapshot
FROM production_batches;

-- 3. Borrar tabla vieja
DROP TABLE production_batches;

-- 4. Renombrar
ALTER TABLE production_batches_v2 RENAME TO production_batches;

-- 5. Recrear índices
CREATE INDEX IF NOT EXISTS idx_production_batches_recipe ON production_batches(recipe_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_branch ON production_batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_status ON production_batches(status);

PRAGMA foreign_keys = ON;
