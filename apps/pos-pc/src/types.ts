export type CategoryType = 'panes' | 'facturas' | 'pasteleria' | 'bebidas' | 'salados';

export interface Ingredient {
  id: string;
  name: string;
  stock: number; // in kg/L/units
  unit: 'kg' | 'g' | 'L' | 'ml' | 'unidades';
  minStock: number;
  unitCost: number; // Cost per unit
}

export interface ProductIngredient {
  ingredientId: string;
  quantity: number; // Quantity needed per product unit (e.g., 0.05 kg of harina for a bread load)
}

export interface ProductGroup {
  id: string;
  nombre: string;
  cantidad: number;
  descuento: number;
  descuento_tipo: 'porcentaje' | 'fijo';
  admite_acum_desc: 0 | 1;
  orden: 1 | 2 | 3;
}

export interface Product {
  id: string;
  name: string;
  category: CategoryType;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  image: string; // Emoji or Lucide icon key
  code: string; // Barcode simulation
  ingredients: ProductIngredient[];
  elaborationDate?: string; // YYYY-MM-DD format
  durabilityDays?: number; // expiry days
  groups?: ProductGroup[]; // grupos de venta por presentación (hasta 3)
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  cost?: number; // snapshot del costo al momento de la venta — evita COGS=0 si se borra el producto
  presentation?: string; // nombre del grupo de venta (p. ej. "Docena"); undefined = unidad
  admite_acum_desc?: 0 | 1; // si el grupo admite descuento acumulado adicional
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  date: string;
  items: SaleItem[];
  /** Lo que efectivamente se cobra al cliente — equivale a `total_final`. */
  total: number;
  /** IVA contenido dentro de `total` (precios con IVA incluido). */
  tax: number;
  // ── Source of truth contable ─────────────────────────────────────────────
  // El frontend calcula estos 3 campos. discount_total es SIEMPRE derivado
  // como subtotal_bruto − total_final. El backend NO los recalcula.
  /** Suma(unit_price × quantity) sin ningún descuento. */
  subtotal_bruto: number;
  /** subtotal_bruto − total_final. Siempre derivado, nunca al revés. */
  discount_total: number;
  /** Igual a `total`. Duplicado intencional para alinear con el backend. */
  total_final: number;
  /** UUID generado al iniciar el cobro — clave de idempotencia con el backend. */
  idempotencyKey: string;
  /** true si el último intento de sync con D1 falló (la venta es local-only por ahora). */
  syncFailed?: boolean;
  paymentMethod: 'tarjeta' | 'transferencia';
  paymentStatus: 'completed' | 'failed' | 'pending' | 'voided';
  operatorRole: string;
  operatorName: string;
  customerName?: string;
  customerDoc?: string;
  customerId?: string;
  sellerId?: string;
  discountPercent?: number;
  discountAmount?: number;
  surchargePercent?: number;
  surchargeAmount?: number;
  paymentAdjustmentType?: 'none' | 'recargo' | 'descuento';
  paymentAdjustmentPercent?: number;
  paymentAdjustmentAmount?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_id: string;
  type: 'consumidor_final' | 'frecuente' | 'mayorista' | 'empresa';
  condicion_fiscal: 'consumidor_final' | 'responsable_inscripto' | 'monotributista' | 'exento';
  price_list_number: number;
  credit_limit: number;
  current_debt: number;
  status: 'active' | 'inactive';
  notes: string;
  created_at: string;
  updated_at: string;
  total_purchases: number;
  last_purchase_date: string;
  timeline: CustomerTimelineEntry[];
}

export interface CustomerTimelineEntry {
  id: string;
  date: string;
  type: 'sale' | 'note' | 'payment' | 'status_change';
  description: string;
  amount?: number;
  user: string;
}

export interface Expense {
  id: string;
  concept: string;
  category: 'materia_prima' | 'servicios' | 'alquiler' | 'salarios' | 'otros';
  amount: number;
  date: string;
  paymentMethod: string;
  invoiceUrl?: string;
}

export type UserRole = 'admin' | 'cajero' | 'panadero';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  avatar: string;
  customPanels: string[];
}

export interface PushNotification {
  id: string;
  title: string;
  message: string;
  type: 'error' | 'warning' | 'info' | 'success';
  timestamp: string;
  read: boolean;
}

export interface PaymentGateway {
  id: string;
  name: string;
  logo: string;
  status: 'active' | 'inactive';
  chargeFee: number; // percentage fee
}

export interface ProductBatch {
  id: string;
  productId: string;
  batchNumber: string;
  quantity: number; // Initial amount in batch
  stock: number; // Current remaining amount
  elaborationDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  status: 'active' | 'withdrawn' | 'sold_out' | 'expired';
  withdrawalMode: 'manual' | 'automatic'; // 'manual' is default (manual predeterminado)
}

export interface BatchWithdrawalRequest {
  id: string;
  batchId: string;
  productId: string;
  productName: string;
  batchNumber: string;
  quantity: number;
  reason: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
  adminMemo?: string; // Details of why approved or denied ("con un detalle del porque")
}

export interface SupplyRequest {
  id: string;
  type: 'ingredient' | 'product';
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
  adminMemo?: string;
}

export interface CashSession {
  id: string;
  openedAt: string;
  closedAt?: string;
  openedBy: string;
  closedBy?: string;
  initialAmount: number;
  expectedAmount: number; // initialAmount + cash sales
  realAmount?: number; // amount declared in counted cash
  discrepancy?: number; // realAmount - expectedAmount
  note?: string;
  status: 'open' | 'closed';
}


