import { useState, useEffect, useCallback } from 'react';
import { INITIAL_INGREDIENTS, INITIAL_PRODUCTS, PAYMENT_GATEWAYS } from '../initialData';
import { safeSetItem } from '../utils/safeStorage';
import { fetchProductsFromD1 } from '../services/d1-sync';
import type { Ingredient, Product, PaymentGateway } from '../types';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

const safeParse = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    localStorage.removeItem(key);
    return fallback;
  }
};

export function useInventory(notify: NotifyFn) {
  const [ingredients, setIngredients] = useState<Ingredient[]>(() =>
    safeParse<Ingredient[]>('pan_erp_ingredients', INITIAL_INGREDIENTS)
  );
  const [products, setProducts] = useState<Product[]>(() =>
    safeParse<Product[]>('pan_erp_products', INITIAL_PRODUCTS)
  );
  const [gateways, setGateways] = useState<PaymentGateway[]>(() =>
    safeParse<PaymentGateway[]>('pan_erp_gateways', PAYMENT_GATEWAYS)
  );

  useEffect(() => {
    safeSetItem('pan_erp_ingredients', JSON.stringify(ingredients));
  }, [ingredients]);

  useEffect(() => {
    safeSetItem('pan_erp_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    safeSetItem('pan_erp_gateways', JSON.stringify(gateways));
  }, [gateways]);

  const addIngredient = (newIng: Omit<Ingredient, 'id'>) => {
    const item: Ingredient = {
      ...newIng,
      id: `ing_${newIng.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`,
    };
    setIngredients(prev => [...prev, item]);
    notify(
      '🌾 Nueva Materia Prima',
      `Se incorporó ${item.name} (${item.unitCost} $/unidad) al catálogo.`,
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
    const prodId = `prod_${newProd.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const code = `77912345${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const today = new Date().toISOString().split('T')[0];
    const productInstance: Product = {
      elaborationDate: today,
      durabilityDays: 2,
      ...newProd,
      id: prodId,
      code,
    };
    setProducts(prev => [...prev, productInstance]);
    notify(
      '🥐 Nuevo Producto',
      `Se agregó "${productInstance.name}" al catálogo de panadería.`,
      'success'
    );
  };

  const updateProductStock = (id: string, newStock: number) => {
    setProducts(prev => prev.map(prod => (prod.id === id ? { ...prod, stock: newStock } : prod)));
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
    setProducts(current => {
      fetchProductsFromD1(current, branchId).then(setProducts).catch(() => {});
      return current;
    });
  }, []);

  return {
    ingredients,
    setIngredients,
    products,
    setProducts,
    gateways,
    setGateways,
    addIngredient,
    updateIngredientStock,
    addProduct,
    updateProductStock,
    toggleGateway,
    refreshProductsFromD1,
  };
}
