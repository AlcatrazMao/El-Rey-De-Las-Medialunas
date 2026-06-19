import type { ProductGroup } from '../types';

/**
 * Calcula el total final de un grupo de venta sobre el precio unitario.
 * - 'porcentaje': aplica un descuento porcentual sobre el subtotal (price * cantidad).
 * - 'fijo': resta un monto absoluto al subtotal.
 * El resultado nunca es negativo.
 */
export function calcularTotalFinal(unitPrice: number, group: ProductGroup): number {
  const base = unitPrice * group.cantidad;
  if (group.descuento_tipo === 'porcentaje') {
    const result = base * (1 - group.descuento / 100);
    return Math.max(0, parseFloat(result.toFixed(2)));
  }
  const result = base - group.descuento;
  return Math.max(0, parseFloat(result.toFixed(2)));
}

/**
 * Precio unitario "efectivo" al cargar el grupo al carrito:
 * total_final / cantidad → permite multiplicar por quantity en líneas existentes.
 */
export function calcularPrecioUnitarioGrupo(unitPrice: number, group: ProductGroup): number {
  if (group.cantidad <= 0) return unitPrice;
  return parseFloat((calcularTotalFinal(unitPrice, group) / group.cantidad).toFixed(2));
}

/**
 * Precio base (subtotal sin descuento) — útil para mostrar tachado en UI.
 */
export function calcularPrecioBase(unitPrice: number, group: ProductGroup): number {
  return parseFloat((unitPrice * group.cantidad).toFixed(2));
}
