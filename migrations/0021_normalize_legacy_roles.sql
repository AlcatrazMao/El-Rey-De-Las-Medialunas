-- ============================================================================
-- MIGRATION 0021: Normalizar roles legacy en español a los códigos EN vigentes
-- El Rey De Las Medialunas - ERP + POS System
-- D1 (SQLite)
-- ============================================================================
--
-- Desde 0003, users.role quedó como TEXT sin CHECK (para poder migrar datos
-- libremente). Esta migración normaliza los valores legacy en español que
-- todavía puedan existir en filas viejas hacia los códigos EN que usa el
-- backend (@medialunas/shared Role type). Es idempotente: cada UPDATE tiene
-- WHERE que solo afecta filas con el valor legacy exacto, así que correrla
-- de nuevo (o varias veces) no tiene efecto una vez normalizado.
--
-- Mapeo:
--   cajero     -> cashier
--   panadero   -> production   (rol de producción/panadería)
--   cocinero   -> production   (no hay rol "kitchen" separado en este sistema;
--                                se unifica con production, mismo criterio
--                                que "panadero")
--   repartidor -> driver       (nuevo rol, agregado en 0022)
--   admin/owner/supervisor/production/warehouse -> sin cambios

UPDATE users SET role = 'cashier'    WHERE role = 'cajero';
UPDATE users SET role = 'production' WHERE role = 'panadero';
UPDATE users SET role = 'production' WHERE role = 'cocinero';
UPDATE users SET role = 'driver'     WHERE role = 'repartidor';
