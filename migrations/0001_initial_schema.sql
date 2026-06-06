-- ============================================================================
-- MIGRATION 0001: Initial Schema
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite) — 27 tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. branches
-- ----------------------------------------------------------------------------
CREATE TABLE branches (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    address TEXT,
    phone TEXT,
    email TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    is_active INTEGER NOT NULL DEFAULT 1,
    opening_time TEXT DEFAULT '06:00',
    closing_time TEXT DEFAULT '22:00',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

-- ----------------------------------------------------------------------------
-- 2. users
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    firebase_uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','admin','supervisor','cashier','production','warehouse')),
    phone TEXT,
    avatar_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

-- ----------------------------------------------------------------------------
-- 3. user_branches
-- ----------------------------------------------------------------------------
CREATE TABLE user_branches (
    user_id TEXT NOT NULL REFERENCES users(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, branch_id)
);

-- ----------------------------------------------------------------------------
-- 4. categories
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    parent_id TEXT REFERENCES categories(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT DEFAULT '#8B4513',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX idx_categories_branch ON categories(branch_id);
CREATE INDEX idx_categories_parent ON categories(parent_id);

-- ----------------------------------------------------------------------------
-- 5. products
-- ----------------------------------------------------------------------------
CREATE TABLE products (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    code TEXT NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    thumbnail_url TEXT,
    category_id TEXT NOT NULL REFERENCES categories(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    unit TEXT NOT NULL DEFAULT 'unit' CHECK(unit IN ('unit','kg','g','l','ml','dozen','pack')),
    price REAL NOT NULL CHECK(price >= 0),
    cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0),
    tax_rate REAL NOT NULL DEFAULT 21.0,
    min_stock REAL NOT NULL DEFAULT 0,
    max_stock REAL NOT NULL DEFAULT 999999,
    track_inventory INTEGER NOT NULL DEFAULT 1,
    is_producible INTEGER NOT NULL DEFAULT 0,
    is_raw_material INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    UNIQUE(code, branch_id)
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_branch ON products(branch_id);
CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_products_barcode ON products(barcode);

-- ----------------------------------------------------------------------------
-- 6. product_aliases
-- ----------------------------------------------------------------------------
CREATE TABLE product_aliases (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_product_aliases_product ON product_aliases(product_id);

-- ----------------------------------------------------------------------------
-- 7. product_prices
-- ----------------------------------------------------------------------------
CREATE TABLE product_prices (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    price_list_type TEXT NOT NULL CHECK(price_list_type IN ('retail','wholesale','promotional')),
    price REAL NOT NULL CHECK(price >= 0),
    start_date TEXT,
    end_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_product_prices_product ON product_prices(product_id);
CREATE INDEX idx_product_prices_branch ON product_prices(branch_id);

-- ----------------------------------------------------------------------------
-- 8. inventory
-- ----------------------------------------------------------------------------
CREATE TABLE inventory (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    current_quantity REAL NOT NULL DEFAULT 0,
    reserved_quantity REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    max_stock REAL NOT NULL DEFAULT 999999,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, branch_id)
);

CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_inventory_branch ON inventory(branch_id);

-- ----------------------------------------------------------------------------
-- 9. inventory_batches
-- ----------------------------------------------------------------------------
CREATE TABLE inventory_batches (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    batch_number TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    cost_per_unit REAL NOT NULL,
    initial_quantity REAL NOT NULL,
    remaining_quantity REAL NOT NULL,
    inventory_method TEXT NOT NULL DEFAULT 'FIFO' CHECK(inventory_method IN ('FIFO','LIFO')),
    supplier_id TEXT,
    purchase_order_id TEXT,
    production_batch_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_inventory_batches_product ON inventory_batches(product_id);
CREATE INDEX idx_inventory_batches_branch ON inventory_batches(branch_id);

-- ----------------------------------------------------------------------------
-- 10. stock_movements
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 11. sales
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 12. sale_items
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 13. sale_payments
-- ----------------------------------------------------------------------------
CREATE TABLE sale_payments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','credit_card','debit_card','transfer','digital_wallet')),
    amount REAL NOT NULL CHECK(amount > 0),
    reference TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

-- ----------------------------------------------------------------------------
-- 14. customers
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    document_type TEXT CHECK(document_type IN ('dni','cuit','cuil','passport')),
    document_number TEXT,
    type TEXT NOT NULL DEFAULT 'consumer' CHECK(type IN ('consumer','frequent','wholesale','corporate')),
    credit_limit REAL NOT NULL DEFAULT 0,
    current_debt REAL NOT NULL DEFAULT 0,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX idx_customers_document ON customers(document_number);
CREATE INDEX idx_customers_type ON customers(type);

-- ----------------------------------------------------------------------------
-- 15. cash_sessions
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 16. cash_movements
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 17. production_recipes
-- ----------------------------------------------------------------------------
CREATE TABLE production_recipes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    yield_quantity REAL NOT NULL,
    preparation_instructions TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_production_recipes_product ON production_recipes(product_id);

-- ----------------------------------------------------------------------------
-- 18. recipe_ingredients
-- ----------------------------------------------------------------------------
CREATE TABLE recipe_ingredients (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    recipe_id TEXT NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
    ingredient_product_id TEXT NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit TEXT NOT NULL,
    waste_percentage REAL NOT NULL DEFAULT 5.0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX idx_recipe_ingredients_product ON recipe_ingredients(ingredient_product_id);

-- ----------------------------------------------------------------------------
-- 19. production_batches
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 20. suppliers
-- ----------------------------------------------------------------------------
CREATE TABLE suppliers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    tax_id TEXT,
    payment_terms TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

-- ----------------------------------------------------------------------------
-- 21. purchase_orders
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 22. purchase_order_items
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 23. transfer_orders
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 24. transfer_order_items
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 25. audit_log
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 26. sync_log
-- ----------------------------------------------------------------------------
CREATE TABLE sync_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    client_id TEXT,
    server_id TEXT,
    entity_type TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','conflict','failed')),
    client_timestamp TEXT NOT NULL,
    server_timestamp TEXT,
    conflict_data TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sync_log_branch ON sync_log(branch_id);
CREATE INDEX idx_sync_log_status ON sync_log(status);
CREATE INDEX idx_sync_log_entity ON sync_log(entity_type);

-- ----------------------------------------------------------------------------
-- 27. sessions
-- ----------------------------------------------------------------------------
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
