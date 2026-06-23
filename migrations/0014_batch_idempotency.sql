-- ============================================================================
-- MIGRATION 0013: Add idempotency_key to inventory_batches
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- El sync offline puede reintentar el POST /batches tras un timeout, duplicando
-- el lote y el remaining_quantity (inventario inflado). El idempotency_key
-- permite al backend detectar el retry y retornar el lote original sin re-insertar.
--
-- El índice UNIQUE parcial (WHERE idempotency_key IS NOT NULL) garantiza
-- unicidad solo cuando la key está presente, sin afectar lotes creados sin ella.

ALTER TABLE inventory_batches ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_idempotency
  ON inventory_batches (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
