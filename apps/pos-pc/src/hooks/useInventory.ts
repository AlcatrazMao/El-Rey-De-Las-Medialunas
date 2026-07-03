import { useState, useEffect, useCallback, useRef } from 'react';

/** UUID sin guiones, compatible con todos los entornos modernos (HTTPS o localhost). */
const uid = () => crypto.randomUUID().replace(/-/g, '');

import { INITIAL_INGREDIENTS, INITIAL_PRODUCTS, PAYMENT_GATEWAYS } from '../initialData';
import { fetchProductsFromD1, syncProductToD1, syncProductUpdateToD1 } from '../services/d1-sync';
import type { Ingredient, Product, PaymentGateway, ProductGroup } from '../types';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

export function useInventory(notify: NotifyFn) {
  const [ingredients, setIngredients] = useState<Ingredient[]>(() =>
    safeParseLocalStorage<Ingredient[]>('pan_erp_ingredients', INITIAL_INGREDIENTS)
  );
  const [products, setProducts] = useState<Product[]>(() =>
    safeParseLocalStorage<Product[]>('pan_erp_products', INITIAL_PRODUCTS)
  );
  const [gateways, setGateways] = useState<PaymentGateway[]>(() =>
    safeParseLocalStorage<PaymentGateway[]>('pan_erp_gateways', PAYMENT_GATEWAYS)
  );

  const ingredientsRef = useRef<Ingredient[]>(ingredients);
  useEffect(() => {
    ingredientsRef.current = ingredients;
    safeSetItem('pan_erp_ingredients', JSON.stringify(ingredients));
  }, [ingredients]);

  const productsRef = useRef<Product[]>(products);
  useEffect(() => {
    productsRef.current = products;
    safeSetItem('pan_erp_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    safeSetItem('pan_erp_gateways', JSON.stringify(gateways));
  }, [gateways]);

  const addIngredient = (newIng: Omit<Ingredient, 'id'>) => {
    const item: Ingredient = {
      ...newIng,
      id: `ing_${newIng.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${uid()}`,
    };
    setIngredients(prev => [...prev, item]);
    notify(
      '🌾 Nueva Materia Prima',
      `Se incorporó ${item.name} (${item.unitCost?.toFixed(2)} $/unidad) al catálogo.`,
      'success'
    );
  };

  /**
   * Edita campos de un insumo existente (modal de edición en InventoryView).
   *
   * A diferencia de updateProduct, esto NO llama al backend: no existe una
   * tabla `ingredients` en D1 ni un recurso REST equivalente — todo el
   * catálogo de materia prima vive únicamente en localStorage, igual que
   * addIngredient/updateIngredientStock (ninguna de las dos sincroniza con
   * D1 tampoco). recipe_ingredients.ingredient_product_id referencia la
   * tabla `products`, no una tabla de insumos separada, así que agregar un
   * PUT contra un recurso que nunca tuvo un POST de creación dejaría el
   * endpoint sin filas que actualizar. Mismo patrón que updateIngredientStock:
   * optimistic update local puro, usando el ref para evitar closures stale.
   */
  const updateIngredient = (
    id: string,
    changes: Partial<Pick<Ingredient, 'name' | 'unit' | 'unitCost' | 'minStock'>>
  ) => {
    const previous = ingredientsRef.current.find(ing => ing.id === id);
    if (!previous) return;

    setIngredients(prev => prev.map(ing => (ing.id === id ? { ...ing, ...changes } : ing)));

    notify(
      '✏️ Insumo Actualizado',
      `Se actualizaron los datos de "${changes.name ?? previous.name}".`,
      'success'
    );
  };

  const updateIngredientStock = (id: string, newStock: number) => {
    setIngredients(prev =>
      prev.map(ing => {
        if (ing.id !== id) return ing;
        const diff = newStock - ing.stock;
        if (diff !== 0) {
          notify(
            '🔄 Stock Actualizado',
            `Se ${diff > 0 ? 'incrementó' : 'descontó'} ${Math.abs(diff)} ${ing.unit} de ${ing.name}. Nuevo stock: ${newStock}.`,
            'info'
          );
        }
        return { ...ing, stock: newStock };
      })
    );
  };

  const addProduct = (newProd: Omit<Product, 'id' | 'code'>) => {
    const prodId = `prod_${newProd.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${uid()}`;
    const code = `77912345${uid().slice(-5).toUpperCase()}`;
    const today = new Date().toISOString().split('T')[0];
    const productInstance: Product = {
      elaborationDate: today,
      durabilityDays: 2,
      ...newProd,
      id: prodId,
      code,
    };
    setProducts(prev => [...prev, productInstance]);
    syncProductToD1({
      id: prodId,
      name: productInstance.name,
      code: productInstance.code,
      price: productInstance.price,
      cost: productInstance.cost ?? 0,
      minStock: productInstance.minStock ?? 5,
      category: productInstance.category,
      isRawMaterial: productInstance.isRawMaterial,
      isProducible: productInstance.isProducible,
      unit: productInstance.unit,
    }).catch(() => {
      // Surface the failure: the product lives locally but the backend never
      // received it. Background sync engine will retry, but the user should know.
      notify(
        '⚠️ Producto sin sincronizar',
        `"${productInstance.name}" se guardó localmente, pero no pudo sincronizarse. Se reintentará automáticamente.`,
        'warning'
      );
    });
    notify(
      '🥐 Nuevo Producto',
      `Se agregó "${productInstance.name}" al catálogo de panadería.`,
      'success'
    );
  };

  /**
   * Edita campos de un producto existente (modal de edición en InventoryView).
   * Mismo patrón que addProduct: optimistic update local primero, luego se
   * intenta sincronizar al backend vía PUT /products/:id. A diferencia de
   * addProduct, si la sync falla NO se encola (enqueue() en d1-sync sólo
   * soporta operation "create" — extenderlo a "update" queda fuera de alcance
   * de v1). En su lugar avisamos con un error pidiendo reintentar manualmente.
   */
  const updateProduct = (
    id: string,
    changes: Partial<Pick<Product, 'name' | 'category' | 'price' | 'cost' | 'minStock' | 'code' | 'image' | 'isRawMaterial' | 'isProducible' | 'unit'>>
  ) => {
    const previous = productsRef.current.find(prod => prod.id === id);
    if (!previous) return;

    // Optimistic update: reflejamos el cambio local de inmediato.
    setProducts(prev => prev.map(prod => (prod.id === id ? { ...prod, ...changes } : prod)));

    syncProductUpdateToD1(id, {
      name: changes.name,
      code: changes.code,
      price: changes.price,
      cost: changes.cost,
      minStock: changes.minStock,
      category: changes.category,
      isRawMaterial: changes.isRawMaterial,
      isProducible: changes.isProducible,
      unit: changes.unit,
    }).catch(() => {
      // El cambio ya vive en el estado local (offline-first), pero el backend
      // no lo recibió. Sin cola de reintento para updates (fuera de alcance v1):
      // el usuario debe reintentar guardarlo manualmente más tarde.
      notify(
        '❌ Cambios sin sincronizar',
        `Los cambios en "${previous.name}" se guardaron localmente, pero no pudieron sincronizarse con el servidor. Reintentá guardarlos nuevamente.`,
        'error'
      );
    });
  };

  const updateProductStock = (id: string, newStock: number) => {
    setProducts(prev => prev.map(prod => (prod.id === id ? { ...prod, stock: newStock } : prod)));
  };

  const updateProductGroups = (id: string, groups: ProductGroup[]) => {
    setProducts(prev => prev.map(prod => (prod.id === id ? { ...prod, groups } : prod)));
  };

  const toggleGateway = (id: string) => {
    setGateways(prev =>
      prev.map(gate => {
        if (gate.id !== id) return gate;
        const targetStatus: PaymentGateway['status'] = gate.status === 'active' ? 'inactive' : 'active';
        notify(
          '🌐 Integración de Pagos',
          `Pasarela ${gate.name} ahora se encuentra: ${targetStatus.toUpperCase()}`,
          targetStatus === 'active' ? 'success' : 'warning'
        );
        return { ...gate, status: targetStatus };
      })
    );
  };

  const refreshProductsFromD1 = useCallback((branchId: string) => {
    fetchProductsFromD1(productsRef.current, branchId)
      .then(result => { if (result) setProducts(result); })
      .catch(() => {});
  }, []);

  return {
    ingredients,
    setIngredients,
    products,
    setProducts,
    gateways,
    setGateways,
    addIngredient,
    updateIngredient,
    updateIngredientStock,
    addProduct,
    updateProduct,
    updateProductStock,
    updateProductGroups,
    toggleGateway,
    refreshProductsFromD1,
  };
}
