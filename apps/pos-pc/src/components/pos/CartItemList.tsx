import { Plus, Minus, Trash2 } from 'lucide-react';
import * as React from 'react';

import type { IDBOffer } from '../../lib/idb';
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
  /** Resta una unidad o delta fraccionario de un item libre (sin presentation). */
  decreaseQuantity: (productId: string) => void;
  /** Suma una unidad de un item "libre" (sin presentation). */
  addUnitToCart: (product: Product) => void;
  /** Beep audible — se invoca con (freq, duration). */
  playBeep: (freq?: number, duration?: number) => void;
  /** Handler para el placeholder vacío (abre el modal de selección). */
  onEmptyClick: () => void;
  /** Ofertas activas del día — usadas para mostrar badge por línea. */
  activeOffers?: IDBOffer[];
}

interface WeighableQuantityInputProps {
  quantity: number;
  unit: string;
  productName: string;
  onCommitQuantity: (newQty: number) => void;
}

const WeighableQuantityInput: React.FC<WeighableQuantityInputProps> = ({
  quantity,
  unit,
  productName,
  onCommitQuantity,
}) => {
  const [localVal, setLocalVal] = React.useState<string>(() => String(quantity));
  const isFocusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(String(quantity));
    }
  }, [quantity]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(',', '.');
    setLocalVal(raw);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      onCommitQuantity(parsed);
    }
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    const parsed = parseFloat(localVal);
    if (Number.isFinite(parsed) && parsed > 0) {
      setLocalVal(String(parsed));
      onCommitQuantity(parsed);
    } else {
      setLocalVal(String(quantity));
    }
  };

  return (
    <label className="text-xs flex items-center gap-1">
      <input
        aria-label={`Cantidad de ${productName} en ${unit}`}
        type="number"
        step="any"
        min="0.001"
        value={localVal}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onChange={handleChange}
        onBlur={handleBlur}
        className="w-20 px-1 bg-transparent font-bold text-gray-800 dark:text-zinc-100 outline-none text-center"
      />
      <span className="text-gray-500 dark:text-zinc-400 font-medium">{unit}</span>
    </label>
  );
};

/**
 * Lista de líneas del carrito + empty state.
 * Manejo robusto de pesables (kg, g, l, ml) con inputs decimales estables y
 * decremento fraccionario con el botón `-`.
 */
export const CartItemList: React.FC<CartItemListProps> = ({
  cart,
  setCart,
  decreaseQuantity,
  addUnitToCart,
  playBeep,
  onEmptyClick,
  activeOffers,
}) => {
  const offersByProductId = React.useMemo(() => {
    const map = new Map<string, IDBOffer>();
    if (activeOffers) {
      for (const offer of activeOffers) {
        for (const pid of offer.productIds) {
          if (!map.has(pid)) map.set(pid, offer);
        }
      }
    }
    return map;
  }, [activeOffers]);

  return (
    <div className="flex-1 flex flex-col pr-1 min-w-0">
      {cart.length === 0 ? (
        <button
          type="button"
          onClick={onEmptyClick}
          className="flex-1 group w-full flex flex-col items-center justify-center px-4 text-gray-400 dark:text-zinc-500 border border-dashed border-gray-100 dark:border-zinc-800 rounded-xl cursor-pointer transition-colors duration-200 hover:border-orange-300 dark:hover:border-orange-700 hover:bg-orange-50/40 dark:hover:bg-orange-900/10"
        >
          <span className="text-4xl block mb-2 opacity-50 font-emoji transition-opacity duration-200 group-hover:opacity-100 animate-pulse" role="img" aria-label="bread">🍞</span>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 transition-colors duration-200 group-hover:text-orange-500 dark:group-hover:text-orange-400">Agregar</p>
          <p className="text-[11px] text-gray-400/80 mt-1 transition-colors duration-200 group-hover:text-orange-500/80 dark:group-hover:text-orange-400/80">
            Pulsa para Seleccionar o Vender un Producto
          </p>
        </button>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-zinc-800 mb-4">
          {cart.map((item, lineIdx) => {
            const lineKey = `${item.product.id}::${item.presentation ?? ''}::${lineIdx}`;
            const lineSubtotal = item.unitPrice * item.quantity;
            const offerForLine = offersByProductId.get(item.product.id);
            const isWeighable = !item.presentation && ['kg', 'g', 'l', 'ml'].includes(item.product.unit ?? '');
            const weighableStep = ['g', 'ml'].includes(item.product.unit ?? '') ? 50 : 0.1;

            return (
              <div key={lineKey} className="py-2 flex items-center gap-3 min-w-0">
                {/* Nombre + badges — ocupa espacio flexible a la izquierda */}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="font-bold text-gray-800 dark:text-zinc-100 truncate text-sm md:text-base">
                    {item.product.name}
                    {item.presentation && (
                      <span className="ml-1.5 inline-block bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                        {item.presentation}
                      </span>
                    )}
                    {offerForLine && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                        🏷️ -{offerForLine.discountPercent}%
                      </span>
                    )}
                  </p>
                </div>

                {/* Desktop: datos en UNA fila a la derecha — cantidad, precio, subtotal */}
                <div className="hidden md:flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <span className="text-xs text-gray-400 block">Cant.</span>
                    <span className="text-sm font-bold font-mono text-gray-800 dark:text-zinc-100">
                      {isWeighable ? item.quantity.toFixed(3).replace(/\.?0+$/, '') : item.quantity}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-400 block">Precio</span>
                    <span className="text-sm font-bold font-mono text-amber-600 dark:text-amber-400">{formatCurrency(item.unitPrice)}</span>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <span className="text-xs text-gray-400 block">Subtotal</span>
                    <span className="text-sm font-bold font-mono text-gray-900 dark:text-white">{formatCurrency(lineSubtotal)}</span>
                  </div>
                </div>

                {/* Mobile: compacto como antes */}
                <div className="md:hidden flex flex-col items-end shrink-0">
                  <span className="text-xs font-bold font-mono text-amber-600">{formatCurrency(item.unitPrice)} / {item.product.unit ?? 'unit'}</span>
                  <span className="text-xs font-bold text-gray-700 dark:text-zinc-300">Sub: {formatCurrency(lineSubtotal)}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center border border-gray-200 dark:border-zinc-700 rounded-lg">
                    <button
                      id={`btn-cart-minus-${item.product.id}-${lineIdx}`}
                      onClick={() => {
                        if (isWeighable) {
                          const newQty = parseFloat((item.quantity - weighableStep).toFixed(3));
                          if (newQty <= 0) {
                            setCart(prev => prev.filter((_, i) => i !== lineIdx));
                          } else {
                            setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: newQty } : it));
                          }
                          playBeep(400, 0.05);
                        } else if (item.presentation || item.quantity <= 1) {
                          setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: Math.max(0, it.quantity - 1) } : it).filter(it => it.quantity > 0));
                          playBeep(400, 0.05);
                        } else {
                          decreaseQuantity(item.product.id);
                        }
                      }}
                      className="p-1 text-gray-500 px-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 cursor-pointer"
                      title={isWeighable ? `Restar ${weighableStep} ${item.product.unit ?? ''}` : "Restar 1 unidad"}
                    >
                      <Minus className="h-3 w-3" />
                    </button>

                    {isWeighable ? (
                      <WeighableQuantityInput
                        quantity={item.quantity}
                        unit={item.product.unit ?? 'kg'}
                        productName={item.product.name}
                        onCommitQuantity={(newQty) => {
                          setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: newQty } : it));
                        }}
                      />
                    ) : (
                      <span className="px-2 font-bold font-mono text-gray-800 dark:text-zinc-100">{item.quantity}</span>
                    )}

                    <button
                      id={`btn-cart-plus-${item.product.id}-${lineIdx}`}
                      onClick={() => {
                        if (item.presentation) {
                          setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: it.quantity + 1 } : it));
                          playBeep(1000, 0.05);
                        } else if (isWeighable) {
                          const newQty = parseFloat((item.quantity + weighableStep).toFixed(3));
                          setCart(prev => prev.map((it, i) => i === lineIdx ? { ...it, quantity: newQty } : it));
                          playBeep(1000, 0.05);
                        } else {
                          addUnitToCart(item.product);
                        }
                      }}
                      className="p-1 text-gray-500 px-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 cursor-pointer"
                      title={isWeighable ? `Sumar ${weighableStep} ${item.product.unit ?? ''}` : "Sumar 1 unidad"}
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
