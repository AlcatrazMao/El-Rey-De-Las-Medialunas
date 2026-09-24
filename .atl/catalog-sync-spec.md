# Catalog and sale synchronization repair

## Acceptance criteria
- Product creation keeps one stable ID in the POS, REST API and offline queue.
- A sale is acknowledged only after the server confirms its operation, never merely on HTTP 200.
- Sales retain the branch where they were created, including retries.
- Product units survive create, edit, reload and offline synchronization; kg/g/l/ml accept fractional stock.
- Product detail fields (description, barcode, supplier, attributes, shelf life, storage instructions, maximum stock and production classification) persist in D1 through both write paths.
- Initial stock is created atomically and retries do not duplicate it.
- Search and empty-cart actions visibly say Buscar and Agregar.

## Boundaries
Original repair did not clear local sales or queues. User has since authorized a deliberate reset of fictional data, including production D1, while preserving users, branches and configuration, and rebuilding the old catalog as actual persisted products. Do not guess identities for old unmatched products during ordinary sync. Keep offline operation; surface synchronization failures. Shelf life is a product default, not a substitute for lot-specific expiry. Never touch production before identifying and backing up the exact D1 database.

## References
Odoo Inventory documentation: [units of measure](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html) and [expiration dates](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html). Adopt explicit base units and product shelf life; do not silently convert historical quantities when a unit changes.

## Implemented
- Stable catalog IDs, shared REST/offline writer and transactional initial stock; migration 0028.
- Durable sale outbox, canonical endpoint retries, original branch headers, real acknowledgement, HTTP error classification and visible pending state.
- Legacy product aliases established only by exact SKU and branch. Existing queues are kept; legacy sales replay with stable IDs and preserve sale/void/close ordering.
- kg/g/l/ml decimal cart input; editing/reopening preserves units. Product details round-trip through D1; stock maximum, supplier, barcode, description, shelf life, storage, variants, VAT and production/resale classification.
- Pending product edits are not overwritten by older server snapshots. Pull loads every product page and refreshes after catalog queue acknowledgements.
- New installations no longer seed fictional products, raw materials, sales or batches. Existing cached data is retained.
- New installations also no longer seed fictional expenses or notifications. The admin-only local reset now clears localStorage plus both IndexedDB databases and explicitly does not claim to clear D1.
- Buscar on the floating search action; Agregar on the empty-cart action.

## Verification
Tests execute actual services, React forms/cart, and Hono product endpoints against an in-memory SQLite database with the real initial schema and migration 0028. Coverage includes fractional stock, replay, rollback on FK failure, legacy identity, original branch, failed HTTP 200, and offline edits. Type-check API and POS; no application build.

## Release / follow-up
1. Production D1 identified as `el-rey-db` (`ebb3d95c-8b8c-467b-be37-dc4a1f82ecb6`). Full export before changes saved outside repo at `C:/Users/Alcatraz/Documents/ElRey-D1-backups/el-rey-db-before-reset-20260924-135838.sql`; imported copy passed `PRAGMA integrity_check`.
2. Applied migrations 0024–0028 remotely. Production had 0 products and 0 sales before reset; the only business rows were 2 fictional cash sessions, removed after backup. Preserved 4 users, 2 branches, settings and auth audit log.
3. Recreated 9 legacy catalog definitions in each branch (18 actual D1 products and inventory rows) using `scripts/maintenance/rebuild-catalog.mjs`. Prices/costs are editable drafts multiplied by 1000 per user request; stock is 0. No fictional barcodes, shelf life, or minimum stock were copied. Added missing branch subcategories; production now has 29 categories.
4. Pending: deploy API before frontend (the new client expects stable product IDs and metadata support). Existing device-local demo caches/queues require the admin local reset per device; never assume D1 cleanup also clears browsers.
5. In an authenticated real session, verify create/edit/reload, a 0.250 kg sale after entering real stock, offline/reconnect, and cross-device visibility. Node 22+ is needed for SQLite integration tests (CI uses Node 22; local verification used Node 24).
