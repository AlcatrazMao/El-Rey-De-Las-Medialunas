-- ============================================================================
-- MIGRATION 0023: Document Types (Comprobantes)
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Agrega soporte para 7 tipos de comprobante (Ticket, Factura A/B/C, Nota de
-- Crédito, Remito, Presupuesto), cada uno con numeración correlativa propia
-- por sucursal. Se apoya en la infraestructura de sucursales ya existente
-- (tabla `branches`, agregada en 0001 y usada por multi-branch-transfers).
--
-- Las Facturas A/B/C NO conectan con AFIP real todavía (change futuro), pero
-- necesitan existir end-to-end desde esta migración.
--
-- DESVIACIÓN DEL PLAN ORIGINAL: para la task 1.6 (agregar `document_type` a
-- `sales`), el plan original preguntaba si hacía falta recrear la tabla
-- (patrón de 0022) por el CHECK constraint. Verificado: SQLite SÍ permite
-- `ALTER TABLE ... ADD COLUMN ... CHECK(...)` siempre que (a) el CHECK no
-- referencie otras columnas y (b) el DEFAULT provisto satisfaga el CHECK
-- (acá 'ticket' está incluido en la lista permitida). El patrón de recrear
-- tabla de 0022 era necesario ahí porque se modificaba un CHECK EXISTENTE
-- (el de `role`), algo que SQLite no soporta vía ALTER. Acá es una columna
-- NUEVA con su propio CHECK nuevo, caso que ALTER TABLE ADD COLUMN sí
-- soporta directamente. Por lo tanto se usa el ALTER simple, evitando
-- recrear `sales`, `sale_items` y `sale_payments` innecesariamente.
--
-- Nota: `document_type` en `sales` solo cubre los 4 tipos que se emiten
-- como parte de una venta (ticket/factura_a/b/c). Nota de crédito, remito y
-- presupuesto viven en tablas propias (`credit_notes`, `remitos`, `budgets`)
-- porque no son ventas: la nota de crédito referencia una venta existente,
-- y remito/presupuesto son documentos sin cargo a caja/stock (ver abajo).

-- ── document_sequences: numeración correlativa por sucursal × tipo ─────────
-- Independiente de document_type_settings a propósito (ver abajo): togglear
-- habilitado/deshabilitado nunca debe poder tocar last_number (DT-12).
CREATE TABLE document_sequences (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    document_type TEXT NOT NULL CHECK(document_type IN (
        'ticket','factura_a','factura_b','factura_c','nota_credito','remito','presupuesto'
    )),
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (branch_id, document_type)
);

-- ── document_type_settings: habilitado/deshabilitado por sucursal × tipo ────
-- Tabla DISTINTA de document_sequences a propósito (requirement DT-12):
-- togglear enabled nunca debe poder tocar last_number, y esto se garantiza
-- estructuralmente al no compartir tabla (ni columnas) entre ambos conceptos.
CREATE TABLE document_type_settings (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    document_type TEXT NOT NULL CHECK(document_type IN (
        'ticket','factura_a','factura_b','factura_c','nota_credito','remito','presupuesto'
    )),
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT REFERENCES users(id),
    PRIMARY KEY (branch_id, document_type)
);

-- ── Seed: document_sequences — una fila por branch × 7 tipos, last_number=0 ─
-- Nota: se usa un CTE `WITH dt(document_type) AS (VALUES ...)` (no UNION ALL
-- de 7 SELECTs, ni alias de columna sobre subquery tipo `(VALUES ...) AS
-- dt(col)`) porque D1/SQLite en modo local rechaza ambas variantes:
-- UNION ALL de 7 términos dispara "too many terms in compound SELECT", y el
-- alias de columnas sobre subquery (`AS dt(document_type)`) no es sintaxis
-- válida en SQLite (sí lo es en Postgres/MySQL). El CTE con columna nombrada
-- es la forma que SQLite sí soporta para dar nombre a los valores de VALUES.
WITH dt(document_type) AS (VALUES
    ('ticket'), ('factura_a'), ('factura_b'), ('factura_c'),
    ('nota_credito'), ('remito'), ('presupuesto')
)
INSERT OR IGNORE INTO document_sequences (branch_id, document_type, last_number)
SELECT b.id, dt.document_type, 0
FROM branches b
CROSS JOIN dt;

-- ── Seed: document_type_settings — mismas combinaciones, solo 'ticket' ──────
-- habilitado por default. El deploy inicial no debe cambiar el comportamiento
-- visible del sistema: sigue emitiendo solo Ticket hasta que alguien habilite
-- los demás tipos desde Configuración.
WITH dt(document_type) AS (VALUES
    ('ticket'), ('factura_a'), ('factura_b'), ('factura_c'),
    ('nota_credito'), ('remito'), ('presupuesto')
)
INSERT OR IGNORE INTO document_type_settings (branch_id, document_type, enabled)
SELECT b.id, dt.document_type, CASE WHEN dt.document_type = 'ticket' THEN 1 ELSE 0 END
FROM branches b
CROSS JOIN dt;

-- ── sales.document_type: qué tipo de comprobante emitió esta venta ──────────
-- Ver nota de DESVIACIÓN arriba: ALTER TABLE ADD COLUMN con CHECK es seguro
-- acá porque es una columna nueva (no modifica un CHECK existente).
ALTER TABLE sales ADD COLUMN document_type TEXT NOT NULL DEFAULT 'ticket'
    CHECK(document_type IN ('ticket','factura_a','factura_b','factura_c'));

-- ── credit_notes: Nota de Crédito, siempre atada a una venta existente ──────
-- sale_id es NOT NULL a propósito (requirement DT-7): nunca debe poder
-- crearse una nota de crédito sin venta asociada.
CREATE TABLE credit_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    sale_id TEXT NOT NULL REFERENCES sales(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    sale_number INTEGER NOT NULL,
    reason TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credit_notes_branch ON credit_notes(branch_id);
CREATE INDEX idx_credit_notes_sale ON credit_notes(sale_id);

-- ── remitos: documento de traslado SIN valor comercial ──────────────────────
-- remito_items no lleva unit_price/tax_rate/total a propósito (DT-8): un
-- remito no tiene valor comercial, solo acredita traslado de mercadería.
CREATE TABLE remitos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    customer_id TEXT REFERENCES customers(id),
    sale_number INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_remitos_branch ON remitos(branch_id);
CREATE INDEX idx_remitos_customer ON remitos(customer_id);

CREATE TABLE remito_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    remito_id TEXT NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    description TEXT
);

CREATE INDEX idx_remito_items_remito ON remito_items(remito_id);
CREATE INDEX idx_remito_items_product ON remito_items(product_id);

-- ── budgets: Presupuesto, completamente separado de sales ───────────────────
-- No afecta stock ni caja (requirement DT-9): sin triggers ni FKs hacia
-- stock_movements/cash_movements. Vive aislado de la operatoria real.
CREATE TABLE budgets (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    customer_id TEXT REFERENCES customers(id),
    sale_number INTEGER NOT NULL,
    valid_until TEXT NOT NULL,
    subtotal REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','expired','cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_budgets_branch ON budgets(branch_id);
CREATE INDEX idx_budgets_customer ON budgets(customer_id);
CREATE INDEX idx_budgets_status ON budgets(status);

CREATE TABLE budget_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL
);

CREATE INDEX idx_budget_items_budget ON budget_items(budget_id);
CREATE INDEX idx_budget_items_product ON budget_items(product_id);
