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
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  cost?: number; // snapshot del costo al momento de la venta — evita COGS=0 si se borra el producto
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  date: string;
  items: SaleItem[];
  total: number;
  tax: number;
  paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago' | 'paypal';
  paymentStatus: 'completed' | 'failed' | 'pending' | 'voided';
  operatorRole: string;
  operatorName: string;
  customerName?: string;
  customerDoc?: string;
  customerId?: string;
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


