-- ============================================================================
-- MIGRATION 0008: Add UNIQUE constraint on (branch_id, sale_number) in sales
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================

-- Migration 0008: Add UNIQUE constraint on (branch_id, sale_number) in sales
-- Prevents duplicate invoice numbers under concurrent requests.
-- If a conflict occurs, the application layer must retry with a new MAX()+1 query.

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_branch_sale_number
  ON sales (branch_id, sale_number);
