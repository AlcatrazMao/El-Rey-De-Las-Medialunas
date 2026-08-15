-- ============================================================================
-- MIGRATION 0024: Nota de crédito "standalone" (devolución desde el carrito)
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- DT-7 originalmente hacía `credit_notes.sale_id` NOT NULL (toda nota de
-- crédito debía referenciar una venta existente). El dueño del negocio pidió
-- un FALLBACK: poder emitir una nota de crédito SIN venta referenciada desde el
-- carrito ("el mundo no es ideal"). En ese caso la nota:
--   - devuelve la mercadería al stock (stock_movements 'return_in' + inventory),
--   - descuenta el monto de la caja (cash_movements 'expense').
--
-- Por eso `sale_id` pasa a nullable y se agrega `credit_note_items` para
-- persistir las líneas de la devolución (producto + cantidad + precio).

-- Preservamos datos existentes: renombramos la tabla vieja, recreamos con el
-- nuevo shape y copiamos. credit_notes no es referenciada por ninguna FK (es
-- tabla hoja, ver 0023), así que el RENAME + recreate es seguro.
ALTER TABLE credit_notes RENAME TO credit_notes_old;

CREATE TABLE credit_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    sale_id TEXT REFERENCES sales(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    sale_number INTEGER NOT NULL,
    reason TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credit_notes_branch ON credit_notes(branch_id);
CREATE INDEX idx_credit_notes_sale ON credit_notes(sale_id);

INSERT INTO credit_notes (id, branch_id, sale_id, user_id, sale_number, reason, amount, created_at)
SELECT id, branch_id, sale_id, user_id, sale_number, reason, amount, created_at
FROM credit_notes_old;

DROP TABLE credit_notes_old;

-- ── credit_note_items: líneas de la devolución standalone ────────────────────
-- Solo se pueblan cuando sale_id es NULL (devolución desde carrito). Las notas
-- referenciando una venta no tienen líneas propias (la venta original ya las
-- tiene vía sale_items).
CREATE TABLE credit_note_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credit_note_items_cn ON credit_note_items(credit_note_id);
CREATE INDEX idx_credit_note_items_product ON credit_note_items(product_id);
