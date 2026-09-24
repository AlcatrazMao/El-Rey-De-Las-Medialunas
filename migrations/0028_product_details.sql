-- Product defaults; actual expiry dates remain on inventory_batches.
ALTER TABLE products ADD COLUMN supplier TEXT;
ALTER TABLE products ADD COLUMN attributes TEXT;
ALTER TABLE products ADD COLUMN shelf_life_days INTEGER CHECK(shelf_life_days IS NULL OR shelf_life_days >= 0);
ALTER TABLE products ADD COLUMN storage_instructions TEXT;
