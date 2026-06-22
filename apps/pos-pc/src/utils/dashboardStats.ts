// Helpers puros para el dashboard. Extraídos para tests aislados y para que
// el `categoryStats` deje de depender de un literal hardcodeado de categorías.

export interface CategorizedProduct {
  id: string;
  category?: string | null;
}

export interface CategorizedSaleItem {
  productId: string;
  subtotal: number;
}

export interface CategorizedSale {
  items: CategorizedSaleItem[];
}

/**
 * Deriva las categorías únicas presentes en un listado de productos.
 * - Filtra `undefined`, `null` y strings vacíos.
 * - Devuelve cada categoría una sola vez (set semantics).
 * - Preserva orden de primera aparición.
 */
export function deriveCategoriesFromProducts(products: readonly CategorizedProduct[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const p of products) {
    const cat = p.category;
    if (typeof cat !== 'string' || cat.length === 0) continue;
    if (seen.has(cat)) continue;
    seen.add(cat);
    ordered.push(cat);
  }
  return ordered;
}

/**
 * Agrupa el monto facturado por categoría a partir de ventas. Las claves del
 * objeto resultante son las categorías derivadas dinámicamente de `products`,
 * inicializadas en 0. Si un producto sin categoría aparece en una venta, se
 * ignora (no se suma a ninguna categoría).
 */
export function buildCategoryStats(
  products: readonly CategorizedProduct[],
  sales: readonly CategorizedSale[],
): Record<string, number> {
  const categories = deriveCategoriesFromProducts(products);
  const stats: Record<string, number> = Object.create(null);
  for (const cat of categories) stats[cat] = 0;

  const productCategoryById = new Map<string, string | undefined>();
  for (const p of products) {
    productCategoryById.set(p.id, typeof p.category === 'string' && p.category.length > 0 ? p.category : undefined);
  }

  for (const sale of sales) {
    for (const item of sale.items) {
      const cat = productCategoryById.get(item.productId);
      if (!cat) continue;
      if (!(cat in stats)) stats[cat] = 0;
      stats[cat] += item.subtotal;
    }
  }
  return stats;
}
