-- ============================================================================
-- MIGRATION 0025: Personalización de comprobantes (global + override por sucursal)
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Permite personalizar la apariencia de cada tipo de comprobante en DOS niveles:
--   1. Global (document_type_customizations): formato default para toda la cadena.
--   2. Por sucursal (document_type_branch_customizations): override opcional.
--
-- La resolución es: branch override > global. Un campo NULL en el override
-- significa "heredar del global" (COALESCE en el endpoint de lectura).
--
-- Campos de personalización:
--   - Título + encabezado/pie: title, header_text, footer_text.
--   - Visibilidad de campos: show_prices, show_tax, show_logo, show_qr,
--     show_customer, show_operator (1 = visible, 0 = oculto).
--   - Datos específicos por tipo: presupuesto_valid_days (solo presupuesto),
--     nota_credito_require_reason (solo nota_credito), factura_fiscal_legend
--     (solo factura_a/b/c).

-- ── Global defaults ──────────────────────────────────────────────────────────
CREATE TABLE document_type_customizations (
    document_type TEXT PRIMARY KEY CHECK(document_type IN (
        'ticket','factura_a','factura_b','factura_c','nota_credito','remito','presupuesto'
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

-- ── Override por sucursal ────────────────────────────────────────────────────
-- Campos NULL = heredar del global. Solo se persisten los que la sucursal
-- decide pisar.
CREATE TABLE document_type_branch_customizations (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    document_type TEXT NOT NULL CHECK(document_type IN (
        'ticket','factura_a','factura_b','factura_c','nota_credito','remito','presupuesto'
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

-- ── Seed: defaults globales para los 7 tipos ─────────────────────────────────
WITH dt(document_type, title) AS (VALUES
    ('ticket',        'Ticket'),
    ('factura_a',     'Factura A'),
    ('factura_b',     'Factura B'),
    ('factura_c',     'Factura C'),
    ('nota_credito',  'Nota de Crédito'),
    ('remito',        'Remito'),
    ('presupuesto',   'Presupuesto')
)
INSERT OR IGNORE INTO document_type_customizations
    (document_type, title, presupuesto_valid_days)
SELECT dt.document_type, dt.title, CASE WHEN dt.document_type = 'presupuesto' THEN 15 ELSE NULL END
FROM dt;
