-- ============================================================================
-- MIGRATION 0006: Batches expiry/status, sales origin/client_timestamp, offers
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inventory_batches: expiry & lifecycle
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_batches ADD COLUMN expiry_date TEXT;
ALTER TABLE inventory_batches ADD COLUMN durability_days INTEGER;
ALTER TABLE inventory_batches ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn','sold_out','expired'));
ALTER TABLE inventory_batches ADD COLUMN withdrawal_reason TEXT;

-- ----------------------------------------------------------------------------
-- sales: provenance & client clock for offline conflict resolution
-- ----------------------------------------------------------------------------
ALTER TABLE sales ADD COLUMN origin TEXT NOT NULL DEFAULT 'web' CHECK(origin IN ('web','local'));
ALTER TABLE sales ADD COLUMN client_timestamp TEXT;

-- ----------------------------------------------------------------------------
-- offers: promotional discounts attached to batches/products
-- ----------------------------------------------------------------------------
CREATE TABLE offers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    discount_percent REAL NOT NULL CHECK(discount_percent > 0 AND discount_percent <= 100),
    batch_ids TEXT NOT NULL DEFAULT '[]',
    product_ids TEXT NOT NULL DEFAULT '[]',
    starts_at TEXT NOT NULL DEFAULT (datetime('now')),
    ends_at TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_offers_branch ON offers(branch_id);
CREATE INDEX idx_offers_status ON offers(status);
CREATE INDEX idx_offers_starts ON offers(starts_at);
