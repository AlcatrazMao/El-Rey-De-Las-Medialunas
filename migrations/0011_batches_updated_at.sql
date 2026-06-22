-- ============================================================================
-- MIGRATION 0011: Add updated_at to inventory_batches for differential sync
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- El PUT /batches/:id ahora actualiza updated_at en cada modificación.
-- Sin esta columna el sync diferencial (pull por updated_at) no detectaba
-- cambios en lotes existentes — solo detectaba inserts nuevos.

ALTER TABLE inventory_batches ADD COLUMN updated_at TEXT;

UPDATE inventory_batches SET updated_at = created_at WHERE updated_at IS NULL;
