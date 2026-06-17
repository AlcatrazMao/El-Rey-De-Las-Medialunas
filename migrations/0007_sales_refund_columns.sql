-- ============================================================================
-- MIGRATION 0007: Columnas dedicadas para refunds en sales
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================

ALTER TABLE sales ADD COLUMN refunded_at TEXT;
ALTER TABLE sales ADD COLUMN refunded_by TEXT REFERENCES users(id);
ALTER TABLE sales ADD COLUMN refund_reason TEXT;
