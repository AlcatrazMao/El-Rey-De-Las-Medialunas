-- ============================================================================
-- MIGRATION 0002: Seed Data
-- El Rey De Las Medialunas - ERP + POS System
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Default Branch (Casa Central)
-- ----------------------------------------------------------------------------
INSERT INTO branches (id, name, code, address, phone, email, timezone, is_active, opening_time, closing_time)
VALUES (
  '00000000000000000000000000000001',
  'Casa Central',
  'CC001',
  'Av. Corrientes 1234, CABA, Buenos Aires',
  '+54 11 4321-5678',
  'casa.central@elreydelasmedialunas.com',
  'America/Argentina/Buenos_Aires',
  1,
  '06:00',
  '22:00'
);

INSERT INTO branches (id, name, code, address, phone, email, timezone, is_active, opening_time, closing_time)
VALUES (
  '00000000000000000000000000000002',
  'Sucursal Palermo',
  'SP002',
  'Av. Santa Fe 3456, Palermo, CABA',
  '+54 11 4789-0123',
  'palermo@elreydelasmedialunas.com',
  'America/Argentina/Buenos_Aires',
  1,
  '07:00',
  '23:00'
);

-- ----------------------------------------------------------------------------
-- Admin Users (placeholders — will be replaced with Firebase UIDs)
-- When Firebase Auth is configured, these firebase_uid values MUST be updated
-- with real Firebase UIDs from the Firebase Console.
-- ----------------------------------------------------------------------------
INSERT INTO users (id, firebase_uid, email, name, role, phone, is_active)
VALUES (
  '00000000000000000000000000000001',
  'FIREBASE_UID_PLACEHOLDER_OWNER',
  'owner@elreydelasmedialunas.com',
  'Administrador Principal',
  'owner',
  '+54 11 5555-0001',
  1
);

INSERT INTO users (id, firebase_uid, email, name, role, phone, is_active)
VALUES (
  '00000000000000000000000000000002',
  'FIREBASE_UID_PLACEHOLDER_ADMIN',
  'admin@elreydelasmedialunas.com',
  'Administrador General',
  'admin',
  '+54 11 5555-0002',
  1
);

INSERT INTO users (id, firebase_uid, email, name, role, phone, is_active)
VALUES (
  '00000000000000000000000000000003',
  'FIREBASE_UID_PLACEHOLDER_CASHIER',
  'cajero@elreydelasmedialunas.com',
  'Cajero Principal',
  'cashier',
  '+54 11 5555-0003',
  1
);

-- ----------------------------------------------------------------------------
-- User-Branch Assignments
-- ----------------------------------------------------------------------------
INSERT INTO user_branches (user_id, branch_id, is_default)
VALUES
  ('00000000000000000000000000000001', '00000000000000000000000000000001', 1),
  ('00000000000000000000000000000001', '00000000000000000000000000000002', 0),
  ('00000000000000000000000000000002', '00000000000000000000000000000001', 1),
  ('00000000000000000000000000000003', '00000000000000000000000000000001', 1);

-- ----------------------------------------------------------------------------
-- Default Categories
-- ----------------------------------------------------------------------------
INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, is_active)
VALUES
  -- Root: Panadería
  ('00000000000000000000000000000C01', NULL, '00000000000000000000000000000001', 'Panadería', 'bakery', '#8B4513', 1, 1),
  -- Root: Pastelería
  ('00000000000000000000000000000C02', NULL, '00000000000000000000000000000001', 'Pastelería', 'cake', '#D2691E', 2, 1),
  -- Root: Cafetería
  ('00000000000000000000000000000C03', NULL, '00000000000000000000000000000001', 'Cafetería', 'coffee', '#6F4E37', 3, 1),
  -- Root: Bebidas
  ('00000000000000000000000000000C04', NULL, '00000000000000000000000000000001', 'Bebidas', 'drink', '#1E90FF', 4, 1),
  -- Root: Promociones
  ('00000000000000000000000000000C05', NULL, '00000000000000000000000000000001', 'Promociones', 'star', '#FFD700', 5, 1);

-- Subcategories — Panadería
INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, is_active)
VALUES
  ('00000000000000000000000000000C06', '00000000000000000000000000000C01', '00000000000000000000000000000001', 'Medialunas', 'croissant', '#8B4513', 1, 1),
  ('00000000000000000000000000000C07', '00000000000000000000000000000C01', '00000000000000000000000000000001', 'Pan Dulce y Salado', 'bread', '#8B4513', 2, 1),
  ('00000000000000000000000000000C08', '00000000000000000000000000000C01', '00000000000000000000000000000001', 'Facturas', 'cookie', '#8B4513', 3, 1),
  ('00000000000000000000000000000C09', '00000000000000000000000000000C01', '00000000000000000000000000000001', 'Galletitas y Masitas', 'cookie-bite', '#8B4513', 4, 1);

-- Subcategories — Pastelería
INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, is_active)
VALUES
  ('00000000000000000000000000000C0A', '00000000000000000000000000000C02', '00000000000000000000000000000001', 'Tortas', 'cake-slice', '#D2691E', 1, 1),
  ('00000000000000000000000000000C0B', '00000000000000000000000000000C02', '00000000000000000000000000000001', 'Postres', 'dessert', '#D2691E', 2, 1);

-- Subcategories — Cafetería
INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, is_active)
VALUES
  ('00000000000000000000000000000C0C', '00000000000000000000000000000C03', '00000000000000000000000000000001', 'Café', 'coffee-bean', '#6F4E37', 1, 1),
  ('00000000000000000000000000000C0D', '00000000000000000000000000000C03', '00000000000000000000000000000001', 'Infusiones', 'tea', '#6F4E37', 2, 1);

-- Subcategories — Bebidas
INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, is_active)
VALUES
  ('00000000000000000000000000000C0E', '00000000000000000000000000000C04', '00000000000000000000000000000001', 'Gaseosas', 'soda', '#1E90FF', 1, 1),
  ('00000000000000000000000000000C0F', '00000000000000000000000000000C04', '00000000000000000000000000000001', 'Aguas y Jugos', 'water', '#1E90FF', 2, 1),
  ('00000000000000000000000000000C10', '00000000000000000000000000000C04', '00000000000000000000000000000001', 'Licuados', 'blender', '#1E90FF', 3, 1);

-- Duplicate categories for Sucursal Palermo (branch 2)
INSERT INTO categories (id, parent_id, branch_id, name, icon, color, sort_order, is_active)
VALUES
  ('00000000000000000000000000000C11', NULL, '00000000000000000000000000000002', 'Panadería', 'bakery', '#8B4513', 1, 1),
  ('00000000000000000000000000000C12', NULL, '00000000000000000000000000000002', 'Pastelería', 'cake', '#D2691E', 2, 1),
  ('00000000000000000000000000000C13', NULL, '00000000000000000000000000000002', 'Cafetería', 'coffee', '#6F4E37', 3, 1),
  ('00000000000000000000000000000C14', NULL, '00000000000000000000000000000002', 'Bebidas', 'drink', '#1E90FF', 4, 1),
  ('00000000000000000000000000000C15', NULL, '00000000000000000000000000000002', 'Promociones', 'star', '#FFD700', 5, 1);
