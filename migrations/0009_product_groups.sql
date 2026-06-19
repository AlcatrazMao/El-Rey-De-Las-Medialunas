-- ============================================================================
-- MIGRATION 0009: Product groups (grupos de venta por presentación)
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Permite asociar hasta 3 grupos de venta a cada producto (por ejemplo:
-- "Docena", "Media docena", "Pack 4"). Cada grupo define una cantidad fija,
-- un descuento (porcentaje o fijo) y un indicador de si admite acumulación
-- de descuentos adicionales en el POS.

CREATE TABLE IF NOT EXISTS product_groups (
    id               TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id       TEXT    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    nombre           TEXT    NOT NULL,
    cantidad         INTEGER NOT NULL CHECK(cantidad >= 2),
    descuento        REAL    NOT NULL DEFAULT 0 CHECK(descuento >= 0),
    descuento_tipo   TEXT    NOT NULL DEFAULT 'porcentaje'
                             CHECK(descuento_tipo IN ('porcentaje','fijo')),
    admite_acum_desc INTEGER NOT NULL DEFAULT 0 CHECK(admite_acum_desc IN (0,1)),
    orden            INTEGER NOT NULL CHECK(orden IN (1,2,3)),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_product_groups_product ON product_groups(product_id);
