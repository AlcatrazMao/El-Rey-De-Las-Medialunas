import type * as React from 'react';
import { useCallback, useRef, useState } from 'react';

import type { CategoryType } from '../types';

// Payload exacto que espera AppContext.addProduct — duplicado intencional
// para no acoplar el hook a la firma completa de Product (sin id/code).
// `code` es opcional: sólo se usa en modo edición (AppContext.updateProduct
// acepta cambiarlo); en modo creación el id/code se generan en addProduct y
// este campo, si viniera seteado, se ignora.
export interface NewProductPayload {
  name: string;
  category: CategoryType;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  image: string;
  code?: string;
  ingredients: { ingredientId: string; quantity: number }[];
}

export interface ProductFormDefaults {
  name?: string;
  category?: CategoryType;
  price?: number;
  cost?: number;
  stock?: number;
  minStock?: number;
  image?: string;
  code?: string;
}

const FALLBACK_DEFAULTS = {
  name: '',
  category: 'panes' as CategoryType,
  price: 1.5,
  cost: 0.5,
  stock: 50,
  minStock: 10,
  image: '🥖',
  code: '',
};

/**
 * Encapsula state + handlers del formulario de creación de producto que vivía
 * inline en InventoryView. Diseño:
 *  - fields: valores controlados (binding directo a inputs)
 *  - setters: mutadores nombrados (mantienen el patrón de useState original)
 *  - recipe: state + helpers de la fórmula dinámica (toggle / set quantity)
 *  - handlers: submit y reset, ambos cierran sobre `onSubmit` provisto
 */
export function useProductForm(
  onSubmit: (payload: NewProductPayload) => void,
  defaults: ProductFormDefaults = {},
) {
  const initial = { ...FALLBACK_DEFAULTS, ...defaults };

  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<CategoryType>(initial.category);
  const [price, setPrice] = useState(initial.price);
  const [cost, setCost] = useState(initial.cost);
  const [stock, setStock] = useState(initial.stock);
  const [minStock, setMinStock] = useState(initial.minStock);
  const [image, setImage] = useState(initial.image);
  const [code, setCode] = useState(initial.code);
  const [recipeIngredients, setRecipeIngredients] = useState<{ ingredientId: string; quantity: number }[]>([]);

  // Ref que siempre apunta al último `initial`. El callback `reset` lee de la
  // ref en lugar de capturar `initial` del primer render — así si el padre
  // pasa defaults nuevos, el reset usa los valores actualizados.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const reset = useCallback(() => {
    const i = initialRef.current;
    setName(i.name);
    setCategory(i.category);
    setPrice(i.price);
    setCost(i.cost);
    setStock(i.stock);
    setMinStock(i.minStock);
    setImage(i.image);
    setCode(i.code);
    setRecipeIngredients([]);
  }, []);

  const toggleRecipeIngredient = useCallback((ingredientId: string, quantity = 1) => {
    setRecipeIngredients(prev => {
      const exists = prev.find(i => i.ingredientId === ingredientId);
      if (exists) return prev.filter(i => i.ingredientId !== ingredientId);
      return [...prev, { ingredientId, quantity }];
    });
  }, []);

  const updateRecipeIngredientQuantity = useCallback((ingredientId: string, quantity: number) => {
    setRecipeIngredients(prev =>
      prev.map(item => item.ingredientId === ingredientId ? { ...item, quantity } : item),
    );
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name,
      category,
      price: Number(price),
      cost: Number(cost),
      stock: Number(stock),
      minStock: Number(minStock),
      image,
      code: code.trim() || undefined,
      ingredients: recipeIngredients,
    });
    reset();
  }, [name, category, price, cost, stock, minStock, image, code, recipeIngredients, onSubmit, reset]);

  return {
    fields: {
      name, category, price, cost, stock, minStock, image, code,
      recipeIngredients,
    },
    setters: {
      setName, setCategory, setPrice, setCost, setStock, setMinStock, setImage, setCode,
    },
    recipe: {
      items: recipeIngredients,
      toggle: toggleRecipeIngredient,
      setQuantity: updateRecipeIngredientQuantity,
    },
    handleSubmit,
    reset,
  };
}
