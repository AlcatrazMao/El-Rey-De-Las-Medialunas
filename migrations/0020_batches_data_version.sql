-- ============================================================================
-- MIGRATION 0020: Versioning de inventory_batches en data_versions
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Agrega la fila 'batches' a data_versions + triggers que la bumpean en cada
-- cambio de inventory_batches. Permite al frontend hacer polling liviano de
-- versión (GET /batches/version) y solo refetchear la lista completa cuando
-- la versión remota difiere de la local. Mismo patrón que 'requests' (0015).

-- Seed inicial de la versión de batches
INSERT OR IGNORE INTO data_versions (key, version) VALUES
  ('batches', 1);

-- ----------------------------------------------------------------------------
-- TRIGGERS: bump data_versions.version cuando cambia inventory_batches
-- Permite al frontend detectar cambios sin polling pesado.
-- ----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_batches_version_insert
AFTER INSERT ON inventory_batches
BEGIN
  UPDATE data_versions
     SET version = version + 1, updated_at = datetime('now')
   WHERE key = 'batches';
END;

CREATE TRIGGER IF NOT EXISTS trg_batches_version_update
AFTER UPDATE ON inventory_batches
BEGIN
  UPDATE data_versions
     SET version = version + 1, updated_at = datetime('now')
   WHERE key = 'batches';
END;

CREATE TRIGGER IF NOT EXISTS trg_batches_version_delete
AFTER DELETE ON inventory_batches
BEGIN
  UPDATE data_versions
     SET version = version + 1, updated_at = datetime('now')
   WHERE key = 'batches';
END;
