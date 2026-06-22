import type * as React from 'react';
import { useCallback, useState } from 'react';

import type { CategoryType } from '../types';

// Payload exacto que espera AppContext.addProduct — duplicado intencional
// para no acoplar el hook a la firma completa de Product (sin id/code).
export interface NewProductPayload {
  name: string;
  category: CategoryType;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  image: string;
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
}

const FALLBACK_DEFAULTS = {
  name: '',
  category: 'panes' as CategoryType,
  price: 1.5,
  cost: 0.5,
  stock: 50,
  minStock: 10,
  image: '🥖',
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
  const [recipeIngredients, setRecipeIngredients] = useState<{ ingredientId: string; quantity: number }[]>([]);

  const reset = useCallback(() => {
    setName(initial.name);
    setCategory(initial.category);
    setPrice(initial.price);
    setCost(initial.cost);
    setStock(initial.stock);
    setMinStock(initial.minStock);
    setImage(initial.image);
    setRecipeIngredients([]);
    // initial es estable dentro del closure del hook — no requiere deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      ingredients: recipeIngredients,
    });
    reset();
  }, [name, category, price, cost, stock, minStock, image, recipeIngredients, onSubmit, reset]);

  return {
    fields: {
      name, category, price, cost, stock, minStock, image,
      recipeIngredients,
    },
    setters: {
      setName, setCategory, setPrice, setCost, setStock, setMinStock, setImage,
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
