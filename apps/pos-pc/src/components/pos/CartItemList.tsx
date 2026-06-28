import { Plus, Minus, Trash2 } from 'lucide-react';
import * as React from 'react';

import type { Product } from '../../types';
import { formatCurrency } from '../../utils/format';

export interface CartLine {
  product: Product;
  quantity: number;
  unitPrice: number;
  presentation?: string;
  admite_acum_desc?: 0 | 1;
}

type SetCart = React.Dispatch<React.SetStateAction<CartLine[]>>;

interface CartItemListProps {
  cart: CartLine[];
  setCart: SetCart;
  /** Resta una unidad de un item "libre" (sin presentation). */
  decreaseQuantity: (productId: string) => void;
  /** Suma una unidad de un item "libre" (sin presentation). */
  addUnitToCart: (product: Product) => void;
  /** Beep audible — se invoca con (freq, duration). */
  playBeep: (freq?: number, duration?: number) => void;
  /** Handler para el placeholder vacío (abre el modal de selección). */
  onEmptyClick: () => void;
}

/**
 * Lista de líneas del carrito + empty state.
 * Sin lógica propia: todas las mutaciones siguen viviendo en POSView vía setCart.
 *
 * El JSX y la semántica son idénticos al inline original. Si la cantidad cae a
 * 0 con `-`, la línea se elimina (preservando la UX previa).
 */
export const CartItemList: React.FC<CartItemListProps> = ({
  cart,
  setCart,
  decreaseQuantity,
  addUnitToCart,
  playBeep,
  onEmptyClick,
}) => {
  return (
    <div className="flex-1 flex flex-col pr-1 min-w-0">
      {cart.length === 0 ? (
        <button
          type="button"
          onClick={onEmptyClick}
          className="flex-1 group w-full flex flex-col items-center justify-center px-4 text-gray-400 dark:text-zinc-500 border border-dashed border-gray-100 dark:border-zinc-800 rounded-xl cursor-pointer transition-colors duration-200 hover:border-orange-300 dark:hover:border-orange-700 hover:bg-orange-50/40 dark:hover:bg-orange-900/10"
        >
          <span className="text-4xl block mb-2 opacity-50 font-emoji transition-opacity duration-200 group-hover:opacity-100" role="img" aria-label="bread">🍞</span>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 transition-colors duration-200 group-hover:text-orange-500 dark:group-hover:text-orange-400">Espera de Selección</p>
          <p className="text-[11px] text-gray-400/80 mt-1 transition-colors duration-200 group-hover:text-orange-500/80 dark:group-hover:text-orange-400/80">
            <span className="group-hover:hidden">Pulsa un panificado o escanea un barcode para facturar</span>
            <span className="hidden group-hover:inline">Tocá para explorar el catálogo</span>
          </p>
        </button>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-zinc-800 space-y-2 mb-4">
          {cart.map((item, lineIdx) => {
            const lineKey = `${item.product.id}::${item.presentation ?? ''}::${lineIdx}`;
            const lineSubtotal = item.unitPrice * item.quantity;
            return (
              <div key={lineKey} className="pt-2 flex items-center justify-between gap-3 min-w-0">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="font-bold text-gray-800 dark:text-zinc-100 truncate text-sm md:text-xs">
                    {item.product.name}
                    {item.presentation && (
                      <span className="ml-1.5 inline-block bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                        {item.presentation}
                      </span>
                    )}
                  </p>
                  <p className="text-xs md:text-[10px] text-amber-600 dark:text-amber-500 font-semibold truncate">
                    {formatCurrency(item.unitPrice)} c/u · Sub: {formatCurrency(lineSubtotal)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center border border-gray-200 dark:border-zinc-700 rounded-lg">
                    <button
                      id={`btn-cart-minus-${item.product.id}-${lineIdx}`}
                      onClick={() => {
                        if (item.presentation) {
                          setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: Math.max(0, it.quantity - 1) } : it).filter(it => it.quantity > 0));
                          playBeep(400, 0.05);
                        } else {
                          decreaseQuantity(item.product.id);
                        }
                      }}
                      className="p-1 text-gray-500 px-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="px-2 font-bold font-mono text-gray-800 dark:text-zinc-100">{item.quantity}</span>
                    <button
                      id={`btn-cart-plus-${item.product.id}-${lineIdx}`}
                      onClick={() => {
                        if (item.presentation) {
                          setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: it.quantity + 1 } : it));
                          playBeep(1000, 0.05);
                        } else {
                          addUnitToCart(item.product);
                        }
                      }}
                      className="p-1 text-gray-500 px-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>

                  <button
                    id={`btn-cart-remove-${item.product.id}-${lineIdx}`}
                    onClick={() => {
                      setCart(prev => prev.filter((_, i) => i !== lineIdx));
                      playBeep(300, 0.1);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 cursor-pointer"
                    title="Eliminar de la orden de venta"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
