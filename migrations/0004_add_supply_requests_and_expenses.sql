-- ============================================================================
-- MIGRATION 0004: Supply Requests + Expenses
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: supply_requests
-- Solicitudes de abastecimiento creadas por panadero/cajero, aprobadas por admin
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_requests (
  id           TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  branch_id    TEXT NOT NULL REFERENCES branches(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL CHECK(type IN ('ingredient', 'product')),
  item_id      TEXT NOT NULL,
  item_name    TEXT NOT NULL,
  quantity     REAL NOT NULL,
  unit         TEXT NOT NULL,
  reason       TEXT,
  requested_by TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  admin_memo   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_supply_requests_branch_id  ON supply_requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_supply_requests_status     ON supply_requests(status);
CREATE INDEX IF NOT EXISTS idx_supply_requests_created_at ON supply_requests(created_at);

-- ----------------------------------------------------------------------------
-- TABLE: expenses
-- Egresos registrados por admin/cajero
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id             TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  branch_id      TEXT NOT NULL REFERENCES branches(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  concept        TEXT NOT NULL,
  category       TEXT NOT NULL CHECK(category IN ('materia_prima', 'servicios', 'alquiler', 'salarios', 'otros')),
  amount         REAL NOT NULL CHECK(amount > 0),
  payment_method TEXT NOT NULL,
  invoice_url    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_branch_id  ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category   ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);
