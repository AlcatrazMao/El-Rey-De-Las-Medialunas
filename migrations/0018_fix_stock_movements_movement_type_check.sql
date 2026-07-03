-- ============================================================================
-- MIGRATION 0018: agrega 'production_waste' al CHECK de stock_movements.movement_type
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- El endpoint POST /batches/:id/complete inserta movement_type='production_waste'
-- cuando hay desperdicio de producción (ver production.ts ~L566), pero el CHECK
-- original no incluía ese valor. SQLite no soporta ALTER TABLE ADD/DROP
-- CONSTRAINT, por lo que se recrea la tabla completa.
--
-- El set de valores se preserva EXACTO al schema actual y se le agrega
-- 'production_waste'. El DROP previo de stock_movements_v2 hace la migración
-- idempotente.

PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS stock_movements_v2;

-- 1. Crear tabla nueva con el CHECK ampliado (agrega 'production_waste')
CREATE TABLE stock_movements_v2 (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    batch_id TEXT REFERENCES inventory_batches(id),
    movement_type TEXT NOT NULL CHECK(movement_type IN (
        'purchase_in','production_in','transfer_in','adjustment_in','return_in',
        'sale_out','transfer_out','waste_out','adjustment_out','production_out',
        'production_waste'
    )),
    quantity REAL NOT NULL,
    unit_cost_at_time REAL,
    reason TEXT,
    reference_type TEXT,
    reference_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copiar todos los datos (columna por columna, orden explícito)
INSERT INTO stock_movements_v2 (
    id, product_id, branch_id, batch_id, movement_type,
    quantity, unit_cost_at_time, reason, reference_type, reference_id,
    user_id, notes, created_at
)
SELECT
    id, product_id, branch_id, batch_id, movement_type,
    quantity, unit_cost_at_time, reason, reference_type, reference_id,
    user_id, notes, created_at
FROM stock_movements;

-- 3. Borrar tabla vieja
DROP TABLE stock_movements;

-- 4. Renombrar
ALTER TABLE stock_movements_v2 RENAME TO stock_movements;

-- 5. Recrear índices
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_branch  ON stock_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type    ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date    ON stock_movements(created_at);

PRAGMA foreign_keys = ON;
