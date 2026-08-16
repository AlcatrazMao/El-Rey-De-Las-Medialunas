-- ============================================================================
-- MIGRATION 0027: agrega idempotency_key a stock_movements
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- El endpoint POST /inventory/adjust (inventory.ts) ya valida y persiste
-- `idempotency_key` (SELECT previo + INSERT con esa columna), igual que
-- `sales` (0010) e `inventory_batches` (0014), pero la columna NUNCA se agregó
-- al schema. Resultado: todo POST /adjust reventaba con "no such column:
-- idempotency_key" → 500. Este mismo patrón de "código + tests escritos pero
-- migración faltante" es el que la auditoría de zonas falsamente implementadas
-- venía persiguiendo.
--
-- El índice UNIQUE parcial (WHERE idempotency_key IS NOT NULL) garantiza
-- unicidad solo cuando la key está presente, sin afectar los movimientos ya
-- existentes (que quedan con la columna NULL).

ALTER TABLE stock_movements ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_idempotency_key
  ON stock_movements (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
