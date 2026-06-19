-- ============================================================================
-- MIGRATION 0010: Add idempotency_key to sales for safe POS retries
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- El POS genera un UUID `idempotency_key` al momento de iniciar el cobro y lo
-- envía con cada POST /sales. El backend valida si ya existe una venta con esa
-- clave antes de insertar — si existe, retorna la venta original sin duplicar.
-- Esto blinda el flujo offline-first: si la red se cae a mitad del request, el
-- POS puede reintentar (manual o vía la cola Dexie) sin riesgo de duplicar la
-- operación en D1.

ALTER TABLE sales ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_idempotency_key
  ON sales (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
