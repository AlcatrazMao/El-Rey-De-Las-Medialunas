-- Fix: Remove CHECK constraint on role to accept Spanish roles (cajero, panadero, admin).
--
-- D1 enforces FK constraints at the schema definition level — even on DROP TABLE.
-- PRAGMA foreign_keys = OFF has no effect in D1.
-- Must drop all 14 tables that directly or indirectly reference users, in dependency order,
-- then recreate them. All affected tables are empty except user_branches (restored below).

-- ── Drop grandchildren first ────────────────────────────────────────────────
DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS sale_payments;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS transfer_order_items;
DROP TABLE IF EXISTS cash_movements;

-- ── Drop children of users ───────────────────────────────────────────────────
DROP TABLE IF EXISTS user_branches;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS production_batches;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS cash_sessions;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS transfer_orders;

-- ── Drop and recreate users without the CHECK constraint ─────────────────────
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    firebase_uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cajero',
    phone TEXT,
    avatar_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

-- ── Recreate all dropped tables ──────────────────────────────────────────────

CREATE TABLE user_branches (
    user_id TEXT NOT NULL REFERENCES users(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    token_hash TEXT NOT NULL,
    refresh_token_hash TEXT,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE audit_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id),
    branch_id TEXT REFERENCES branches(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    old_values TEXT,
    new_values TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_date ON audit_log(created_at);
CREATE INDEX idx_audit_log_action ON audit_log(action);

CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    batch_id TEXT REFERENCES inventory_batches(id),
    movement_type TEXT NOT NULL CHECK(movement_type IN (
        'purchase_in','production_in','transfer_in','adjustment_in','return_in',
        'sale_out','transfer_out','waste_out','adjustment_out','production_out'
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

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_branch ON stock_movements(branch_id);
CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX idx_stock_movements_date ON stock_movements(created_at);

CREATE TABLE sales (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    client_id TEXT,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    customer_id TEXT,
    sale_number INTEGER NOT NULL,
    subtotal REAL NOT NULL,
    discount_total REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','voided','refunded')),
    sync_status TEXT NOT NULL DEFAULT 'synced' CHECK(sync_status IN ('pending','synced','failed')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    voided_at TEXT,
    voided_by TEXT REFERENCES users(id),
    void_reason TEXT
);

CREATE INDEX idx_sales_branch ON sales(branch_id);
CREATE INDEX idx_sales_user ON sales(user_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_date ON sales(created_at);
CREATE INDEX idx_sales_sale_number ON sales(sale_number);
CREATE INDEX idx_sales_sync_status ON sales(sync_status);

CREATE TABLE sale_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    batch_id TEXT REFERENCES inventory_batches(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 21.0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE sale_payments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','credit_card','debit_card','transfer','digital_wallet')),
    amount REAL NOT NULL CHECK(amount > 0),
    reference TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE cash_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    supervisor_id TEXT REFERENCES users(id),
    opening_amount REAL NOT NULL,
    closing_amount REAL,
    expected_amount REAL,
    difference REAL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closing','closed')),
    notes TEXT,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
);

CREATE INDEX idx_cash_sessions_branch ON cash_sessions(branch_id);
CREATE INDEX idx_cash_sessions_user ON cash_sessions(user_id);
CREATE INDEX idx_cash_sessions_status ON cash_sessions(status);

CREATE TABLE cash_movements (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('sale','expense','income','withdrawal')),
    amount REAL NOT NULL,
    description TEXT,
    category TEXT,
    receipt_image_url TEXT,
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(type);
CREATE INDEX idx_cash_movements_date ON cash_movements(created_at);

CREATE TABLE production_batches (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    recipe_id TEXT NOT NULL REFERENCES production_recipes(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    planned_quantity REAL NOT NULL,
    actual_quantity REAL,
    waste_quantity REAL,
    total_cost REAL,
    unit_cost REAL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','cancelled')),
    notes TEXT,
    planned_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX idx_production_batches_recipe ON production_batches(recipe_id);
CREATE INDEX idx_production_batches_branch ON production_batches(branch_id);
CREATE INDEX idx_production_batches_status ON production_batches(status);

CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    order_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','partially_received','received','cancelled')),
    subtotal REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    expected_delivery_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_branch ON purchase_orders(branch_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);

CREATE TABLE purchase_order_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL,
    received_quantity REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_order_items_product ON purchase_order_items(product_id);

CREATE TABLE transfer_orders (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_branch_id TEXT NOT NULL REFERENCES branches(id),
    destination_branch_id TEXT NOT NULL REFERENCES branches(id),
    requested_by TEXT NOT NULL REFERENCES users(id),
    approved_by TEXT REFERENCES users(id),
    shipped_by TEXT REFERENCES users(id),
    received_by TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','in_transit','received','completed')),
    notes TEXT,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT,
    shipped_at TEXT,
    received_at TEXT
);

CREATE INDEX idx_transfer_orders_source ON transfer_orders(source_branch_id);
CREATE INDEX idx_transfer_orders_dest ON transfer_orders(destination_branch_id);
CREATE INDEX idx_transfer_orders_status ON transfer_orders(status);

CREATE TABLE transfer_order_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    transfer_order_id TEXT NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    received_quantity REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transfer_order_items_to ON transfer_order_items(transfer_order_id);
CREATE INDEX idx_transfer_order_items_product ON transfer_order_items(product_id);

-- ── Restore seed data ─────────────────────────────────────────────────────────

INSERT INTO users (id, firebase_uid, email, name, role, phone, is_active)
VALUES
  ('00000000000000000000000000000001', 'FIREBASE_UID_PLACEHOLDER_OWNER',   'owner@elreydelasmedialunas.com',  'Administrador Principal', 'admin',  '+54 11 5555-0001', 1),
  ('00000000000000000000000000000002', 'FIREBASE_UID_PLACEHOLDER_ADMIN',   'admin@elreydelasmedialunas.com',  'Administrador General',   'admin',  '+54 11 5555-0002', 1),
  ('00000000000000000000000000000003', 'FIREBASE_UID_PLACEHOLDER_CASHIER', 'cajero@elreydelasmedialunas.com', 'Cajero Principal',        'cajero', '+54 11 5555-0003', 1);

INSERT INTO user_branches (user_id, branch_id, is_default)
VALUES
  ('00000000000000000000000000000001', '00000000000000000000000000000001', 1),
  ('00000000000000000000000000000001', '00000000000000000000000000000002', 0),
  ('00000000000000000000000000000002', '00000000000000000000000000000001', 1),
  ('00000000000000000000000000000003', '00000000000000000000000000000001', 1);
