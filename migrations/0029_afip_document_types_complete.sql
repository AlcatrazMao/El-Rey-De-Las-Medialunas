-- ============================================================================
-- MIGRATION 0029: AFIP / ARCA Complete Document Types (Comprobantes)
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Reestructura el soporte de comprobantes de facturación para Argentina (AFIP/ARCA)
-- completando los 15 tipos formales:
--   1. Tickets: ticket
--   2. Facturas: factura_a, factura_b, factura_c, factura_m
--   3. Notas de Crédito: nota_credito_a, nota_credito_b, nota_credito_c, nota_credito_m
--   4. Notas de Débito: nota_debito_a, nota_debito_b, nota_debito_c, nota_debito_m
--   5. No fiscales / Operativos: presupuesto, remito
--
-- En SQLite los CHECK constraints existentes no pueden modificarse con ALTER TABLE,
-- por lo que se recrean las tablas siguiendo el patrón seguro de 0022/0026 con
-- PRAGMA foreign_keys = OFF.

PRAGMA foreign_keys = OFF;

-- ── 1. Recrear sales (actualiza CHECK de document_type e incluye idempotency_key) ──
DROP TABLE IF EXISTS sales_v2;

CREATE TABLE sales_v2 (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    client_id TEXT,
    idempotency_key TEXT,
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
    void_reason TEXT,
    document_type TEXT NOT NULL DEFAULT 'ticket' CHECK(document_type IN (
        'ticket',
        'factura_a','factura_b','factura_c','factura_m',
        'nota_credito_a','nota_credito_b','nota_credito_c','nota_credito_m',
        'nota_debito_a','nota_debito_b','nota_debito_c','nota_debito_m',
        'presupuesto','remito'
    ))
);

INSERT INTO sales_v2 (
    id, client_id, branch_id, user_id, customer_id,
    sale_number, subtotal, discount_total, tax_total, total,
    status, sync_status, notes, created_at, voided_at, voided_by, void_reason,
    document_type
)
SELECT
    id, client_id, branch_id, user_id, customer_id,
    sale_number, subtotal, discount_total, tax_total, total,
    status, sync_status, notes, created_at, voided_at, voided_by, void_reason,
    document_type
FROM sales;

DROP TABLE sales;
ALTER TABLE sales_v2 RENAME TO sales;

CREATE INDEX IF NOT EXISTS idx_sales_branch ON sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_sale_number ON sales(sale_number);
CREATE INDEX IF NOT EXISTS idx_sales_sync_status ON sales(sync_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_branch_sale_number ON sales(branch_id, sale_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_idempotency_key ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── 2. Recrear document_sequences con los 15 tipos ─────────────────────────
DROP TABLE IF EXISTS document_sequences_v2;

CREATE TABLE document_sequences_v2 (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    document_type TEXT NOT NULL CHECK(document_type IN (
        'ticket',
        'factura_a','factura_b','factura_c','factura_m',
        'nota_credito_a','nota_credito_b','nota_credito_c','nota_credito_m',
        'nota_debito_a','nota_debito_b','nota_debito_c','nota_debito_m',
        'presupuesto','remito'
    )),
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (branch_id, document_type)
);

-- Migrar datos preservando contadores (mapea 'nota_credito' genérica legacy a 'nota_credito_b')
INSERT OR IGNORE INTO document_sequences_v2 (branch_id, document_type, last_number, updated_at)
SELECT branch_id,
       CASE WHEN document_type = 'nota_credito' THEN 'nota_credito_b' ELSE document_type END,
       last_number,
       updated_at
FROM document_sequences;

DROP TABLE document_sequences;
ALTER TABLE document_sequences_v2 RENAME TO document_sequences;

-- ── 3. Recrear document_type_settings con los 15 tipos ──────────────────────
DROP TABLE IF EXISTS document_type_settings_v2;

CREATE TABLE document_type_settings_v2 (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    document_type TEXT NOT NULL CHECK(document_type IN (
        'ticket',
        'factura_a','factura_b','factura_c','factura_m',
        'nota_credito_a','nota_credito_b','nota_credito_c','nota_credito_m',
        'nota_debito_a','nota_debito_b','nota_debito_c','nota_debito_m',
        'presupuesto','remito'
    )),
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT REFERENCES users(id),
    PRIMARY KEY (branch_id, document_type)
);

INSERT OR IGNORE INTO document_type_settings_v2 (branch_id, document_type, enabled, updated_at, updated_by)
SELECT branch_id,
       CASE WHEN document_type = 'nota_credito' THEN 'nota_credito_b' ELSE document_type END,
       enabled,
       updated_at,
       updated_by
FROM document_type_settings;

DROP TABLE document_type_settings;
ALTER TABLE document_type_settings_v2 RENAME TO document_type_settings;

-- ── 4. Recrear document_type_customizations con los 15 tipos ─────────────────
DROP TABLE IF EXISTS document_type_customizations_v2;

CREATE TABLE document_type_customizations_v2 (
    document_type TEXT PRIMARY KEY CHECK(document_type IN (
        'ticket',
        'factura_a','factura_b','factura_c','factura_m',
        'nota_credito_a','nota_credito_b','nota_credito_c','nota_credito_m',
        'nota_debito_a','nota_debito_b','nota_debito_c','nota_debito_m',
        'presupuesto','remito'
    )),
    title TEXT,
    header_text TEXT,
    footer_text TEXT,
    show_prices INTEGER NOT NULL DEFAULT 1,
    show_tax INTEGER NOT NULL DEFAULT 0,
    show_logo INTEGER NOT NULL DEFAULT 0,
    show_qr INTEGER NOT NULL DEFAULT 0,
    show_customer INTEGER NOT NULL DEFAULT 1,
    show_operator INTEGER NOT NULL DEFAULT 1,
    presupuesto_valid_days INTEGER,
    nota_credito_require_reason INTEGER NOT NULL DEFAULT 1,
    factura_fiscal_legend TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO document_type_customizations_v2 (
    document_type, title, header_text, footer_text,
    show_prices, show_tax, show_logo, show_qr,
    show_customer, show_operator, presupuesto_valid_days,
    nota_credito_require_reason, factura_fiscal_legend, updated_at
)
SELECT
    CASE WHEN document_type = 'nota_credito' THEN 'nota_credito_b' ELSE document_type END,
    title, header_text, footer_text,
    show_prices, show_tax, show_logo, show_qr,
    show_customer, show_operator, presupuesto_valid_days,
    nota_credito_require_reason, factura_fiscal_legend, updated_at
FROM document_type_customizations;

DROP TABLE document_type_customizations;
ALTER TABLE document_type_customizations_v2 RENAME TO document_type_customizations;

-- ── 5. Recrear document_type_branch_customizations con los 15 tipos ──────────
DROP TABLE IF EXISTS document_type_branch_customizations_v2;

CREATE TABLE document_type_branch_customizations_v2 (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    document_type TEXT NOT NULL CHECK(document_type IN (
        'ticket',
        'factura_a','factura_b','factura_c','factura_m',
        'nota_credito_a','nota_credito_b','nota_credito_c','nota_credito_m',
        'nota_debito_a','nota_debito_b','nota_debito_c','nota_debito_m',
        'presupuesto','remito'
    )),
    title TEXT,
    header_text TEXT,
    footer_text TEXT,
    show_prices INTEGER,
    show_tax INTEGER,
    show_logo INTEGER,
    show_qr INTEGER,
    show_customer INTEGER,
    show_operator INTEGER,
    presupuesto_valid_days INTEGER,
    nota_credito_require_reason INTEGER,
    factura_fiscal_legend TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (branch_id, document_type)
);

INSERT OR IGNORE INTO document_type_branch_customizations_v2 (
    branch_id, document_type, title, header_text, footer_text,
    show_prices, show_tax, show_logo, show_qr,
    show_customer, show_operator, presupuesto_valid_days,
    nota_credito_require_reason, factura_fiscal_legend, updated_at
)
SELECT
    branch_id,
    CASE WHEN document_type = 'nota_credito' THEN 'nota_credito_b' ELSE document_type END,
    title, header_text, footer_text,
    show_prices, show_tax, show_logo, show_qr,
    show_customer, show_operator, presupuesto_valid_days,
    nota_credito_require_reason, factura_fiscal_legend, updated_at
FROM document_type_branch_customizations;

DROP TABLE document_type_branch_customizations;
ALTER TABLE document_type_branch_customizations_v2 RENAME TO document_type_branch_customizations;

-- ── 6. Seed: document_sequences para todas las sucursales existentes ─────────
WITH dt(document_type) AS (VALUES
    ('ticket'),
    ('factura_a'), ('factura_b'), ('factura_c'), ('factura_m'),
    ('nota_credito_a'), ('nota_credito_b'), ('nota_credito_c'), ('nota_credito_m'),
    ('nota_debito_a'), ('nota_debito_b'), ('nota_debito_c'), ('nota_debito_m'),
    ('presupuesto'), ('remito')
)
INSERT OR IGNORE INTO document_sequences (branch_id, document_type, last_number)
SELECT b.id, dt.document_type, 0
FROM branches b
CROSS JOIN dt;

-- ── 7. Seed: document_type_settings (solo 'ticket' habilitado por defecto) ───
WITH dt(document_type) AS (VALUES
    ('ticket'),
    ('factura_a'), ('factura_b'), ('factura_c'), ('factura_m'),
    ('nota_credito_a'), ('nota_credito_b'), ('nota_credito_c'), ('nota_credito_m'),
    ('nota_debito_a'), ('nota_debito_b'), ('nota_debito_c'), ('nota_debito_m'),
    ('presupuesto'), ('remito')
)
INSERT OR IGNORE INTO document_type_settings (branch_id, document_type, enabled)
SELECT b.id, dt.document_type, CASE WHEN dt.document_type = 'ticket' THEN 1 ELSE 0 END
FROM branches b
CROSS JOIN dt;

-- ── 8. Seed: document_type_customizations defaults con títulos oficiales ────
WITH dt(document_type, title) AS (VALUES
    ('ticket',          'Ticket'),
    ('factura_a',       'Factura A'),
    ('factura_b',       'Factura B'),
    ('factura_c',       'Factura C'),
    ('factura_m',       'Factura M'),
    ('nota_credito_a',  'Nota de Crédito A'),
    ('nota_credito_b',  'Nota de Crédito B'),
    ('nota_credito_c',  'Nota de Crédito C'),
    ('nota_credito_m',  'Nota de Crédito M'),
    ('nota_debito_a',   'Nota de Débito A'),
    ('nota_debito_b',   'Nota de Débito B'),
    ('nota_debito_c',   'Nota de Débito C'),
    ('nota_debito_m',   'Nota de Débito M'),
    ('presupuesto',     'Presupuesto'),
    ('remito',          'Remito')
)
INSERT OR IGNORE INTO document_type_customizations (document_type, title, presupuesto_valid_days)
SELECT dt.document_type, dt.title, CASE WHEN dt.document_type = 'presupuesto' THEN 15 ELSE NULL END
FROM dt;

PRAGMA foreign_keys = ON;
