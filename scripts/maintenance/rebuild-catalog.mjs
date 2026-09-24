// One-time, opt-in D1 catalog seed. Run with Node 24+; never as a migration.
// node scripts/maintenance/rebuild-catalog.mjs --prices=draft1000 --output=PATH
import { writeFileSync } from 'node:fs';
import { INITIAL_PRODUCTS } from '../../apps/pos-pc/src/initialData.ts';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (!match) throw new Error(`Invalid argument: ${arg}`);
  return [match[1], match[2]];
}));
if (!['zero', 'draft1000'].includes(args.prices) || !args.output) {
  throw new Error('Usage: node scripts/maintenance/rebuild-catalog.mjs --prices=zero|draft1000 --output=PATH');
}

const q = value => `'${String(value).replaceAll("'", "''")}'`;
const categories = [
  ['Pan Dulce y Salado', 'Panadería'],
  ['Facturas', 'Panadería'],
  ['Salados', 'Panadería'],
  ['Tortas', 'Pastelería'],
  ['Postres', 'Pastelería'],
  ['Café', 'Cafetería'],
  ['Aguas y Jugos', 'Bebidas'],
];
const catalog = [
  ['prod_pan_flauta', 'PAN-FLAUTA', 'Pan Dulce y Salado', 'kg'],
  ['prod_felipe', 'PAN-FELIPE', 'Pan Dulce y Salado', 'unit'],
  ['prod_medialuna_manteca', 'FAC-MEDIALUNA-MANTECA', 'Facturas', 'unit'],
  ['prod_vigilante', 'FAC-VIGILANTE', 'Facturas', 'unit'],
  ['prod_torta_frutilla', 'PAS-TARTA-FRUTILLA', 'Tortas', 'unit'],
  ['prod_budin_repostero', 'PAS-BUDIN-CHOCOLATE', 'Postres', 'unit'],
  ['prod_sand_miga', 'SAL-SANDWICH-MIGA-X6', 'Salados', 'pack'],
  ['prod_cafe', 'BEB-CAFE-ESPRESSO', 'Café', 'unit'],
  ['prod_jugo', 'BEB-JUGO-NARANJA', 'Aguas y Jugos', 'unit'],
];
if (INITIAL_PRODUCTS.length !== catalog.length || catalog.some(([id]) => !INITIAL_PRODUCTS.some(p => p.id === id))) {
  throw new Error('Legacy catalog changed; review the seed before using it');
}

const sql = [
  '-- Recreate the nine legacy catalog entries as real D1 products in every active branch.',
  '-- Prices/costs are drafts from the legacy catalog multiplied by 1000 (unless --prices=zero).',
  '-- Stock, min stock, barcode and shelf life are zero/NULL: old values were fictional or unverified.',
  '-- This file is idempotent by (branch_id, code). Keep users, branches and other settings untouched.',
];
for (const [name, root] of categories) {
  sql.push(`INSERT INTO categories (id, parent_id, branch_id, name, sort_order, is_active)
SELECT lower(hex(randomblob(16))), root.id, root.branch_id, ${q(name)}, 1, 1
FROM branches b JOIN categories root ON root.branch_id = b.id AND root.parent_id IS NULL AND root.name = ${q(root)}
WHERE b.is_active = 1 AND NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.branch_id = b.id AND c.name = ${q(name)}
);`);
}
for (const [legacyId, code, category, unit] of catalog) {
  const source = INITIAL_PRODUCTS.find(p => p.id === legacyId);
  const price = args.prices === 'draft1000' ? Math.round(source.price * 1000) : 0;
  const cost = args.prices === 'draft1000' ? Math.round(source.cost * 1000) : 0;
  sql.push(`INSERT INTO products
  (id, code, name, category_id, branch_id, unit, price, cost, min_stock, track_inventory, is_active)
SELECT lower(hex(randomblob(16))), ${q(code)}, ${q(source.name)},
  (SELECT c.id FROM categories c WHERE c.branch_id = b.id AND c.name = ${q(category)} ORDER BY c.id LIMIT 1),
  b.id, ${q(unit)}, ${price}, ${cost}, 0, 1, 1
FROM branches b
WHERE b.is_active = 1
  AND EXISTS (SELECT 1 FROM categories c WHERE c.branch_id = b.id AND c.name = ${q(category)})
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.branch_id = b.id AND p.code = ${q(code)});`);
  sql.push(`INSERT INTO inventory (id, product_id, branch_id, current_quantity, min_stock)
SELECT lower(hex(randomblob(16))), p.id, p.branch_id, 0, 0
FROM products p JOIN branches b ON b.id = p.branch_id
WHERE b.is_active = 1 AND p.code = ${q(code)}
  AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.id AND i.branch_id = p.branch_id);`);
}
writeFileSync(args.output, `${sql.join('\n\n')}\n`, { flag: 'wx' });
console.log(`Wrote ${catalog.length} catalog definitions to ${args.output} (prices=${args.prices})`);
