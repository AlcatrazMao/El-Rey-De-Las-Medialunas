import * as React from 'react';

import type { Product } from '../../hooks/useInventory';
import { useLongPress } from '../../hooks/useLongPress';
import { formatCurrency } from '../../utils/format';

export interface ProductCardProps {
  product: Product;
  quantityInCart: number;
  onAddToCart: (product: Product) => void;
  onDecreaseQuantity: (productId: string) => void;
  playBeep?: (freq: number, duration: number) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  quantityInCart,
  onAddToCart,
  onDecreaseQuantity,
  playBeep,
}) => {
  const inStock = product.stock > 0;
  const lowStock = product.stock <= (product.minStock || 5);

  const { handlers, isPressing, isDiscounting } = useLongPress({
    threshold: 500,
    onShortClick: () => {
      onAddToCart(product);
      playBeep?.(800, 0.05);
    },
    onLongPress: () => {
      onDecreaseQuantity(product.id);
      playBeep?.(400, 0.08);
    },
  });

  return (
    <button
      type="button"
      id={`product-card-${product.id}`}
      {...handlers}
      className={`relative flex flex-col justify-between text-left p-3 rounded-2xl border transition-all cursor-pointer select-none group ${
        isDiscounting
          ? 'ring-4 ring-red-400 bg-red-100/70 dark:bg-red-950/50 scale-95 border-red-400'
          : isPressing
          ? 'scale-97 ring-2 ring-amber-400 bg-amber-50/50 dark:bg-amber-950/20'
          : !inStock
          ? 'bg-red-50/40 dark:bg-red-950/10 border-red-200 dark:border-red-900/40 hover:bg-red-50/60'
          : lowStock
          ? 'bg-amber-50/40 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/60 hover:bg-amber-50/70'
          : 'bg-white dark:bg-zinc-850 hover:bg-orange-50/30 dark:hover:bg-zinc-800 border-amber-100/40 dark:border-zinc-850/50 hover:border-amber-200 shadow-xs'
      }`}
    >
      {/* Feedback visual al descontar por long-press */}
      {isDiscounting && (
        <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] font-black rounded-full px-2 py-0.5 shadow-md animate-bounce z-20">
          -1
        </span>
      )}

      {/* Indicador de cantidad en el carrito */}
      {quantityInCart > 0 && !isDiscounting && (
        <span className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center shadow-xs z-10">
          {quantityInCart}
        </span>
      )}

      <div className="text-2xl mb-1" role="img" aria-label={product.name}>
        {product.image}
      </div>
      <div>
        <span
          className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mb-1 ${
            !inStock ? 'bg-red-100 text-red-700' : lowStock ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          {!inStock ? 'SIN STOCK' : `${product.stock}u`}
        </span>
        <p className="font-extrabold text-xs text-gray-800 dark:text-zinc-100 leading-snug line-clamp-2">
          {product.name}
        </p>
      </div>
      <span className="text-sm font-extrabold text-amber-600 dark:text-amber-500 mt-2">
        {formatCurrency(product.price)}
      </span>
    </button>
  );
};
