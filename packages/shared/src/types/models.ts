import type {
  Role,
  UnitType,
  PaymentMethod,
  PriceListType,
  OrderStatus,
  TransferStatus,
  CustomerType,
  SyncStatus,
  SyncOperation,
  CashSessionStatus,
  CashMovementType,
  ProductionBatchStatus,
  PurchaseOrderStatus,
  InventoryMethod,
  DocumentType,
} from "./enums";

export interface Timestamps {
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Branch extends Timestamps {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  timezone: string;
  is_active: boolean;
  opening_time: string;
  closing_time: string;
}

export interface User extends Timestamps {
  id: string;
  firebase_uid: string;
  email: string;
  name: string;
  role: Role;
  phone?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  last_login_at?: string | null;
}

export interface UserBranch {
  user_id: string;
  branch_id: string;
  is_default: boolean;
  created_at: string;
}

export interface Category extends Timestamps {
  id: string;
  parent_id?: string | null;
  branch_id: string;
  name: string;
  icon?: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
  children?: Category[];
}

export interface Product extends Timestamps {
  id: string;
  code: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  category_id: string;
  branch_id: string;
  unit: UnitType;
  price: number;
  cost: number;
  tax_rate: number;
  min_stock: number;
  max_stock: number;
  track_inventory: boolean;
  is_producible: boolean;
  is_raw_material: boolean;
  is_active: boolean;
}

export interface ProductAlias {
  id: string;
  product_id: string;
  alias: string;
  created_at: string;
}

export interface ProductGroup {
  id: string;
  product_id: string;
  nombre: string;
  cantidad: number;
  descuento: number;
  descuento_tipo: "porcentaje" | "fijo";
  admite_acum_desc: 0 | 1;
  orden: 1 | 2 | 3;
  created_at: string;
  updated_at: string;
}

export interface ProductWithGroups extends Product {
  groups: ProductGroup[];
}

export interface ProductPrice {
  id: string;
  product_id: string;
  branch_id: string;
  price_list_type: PriceListType;
  price: number;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  product_id: string;
  branch_id: string;
  current_quantity: number;
  reserved_quantity: number;
  min_stock: number;
  max_stock: number;
  updated_at: string;
}

export interface InventoryBatch {
  id: string;
  product_id: string;
  branch_id: string;
  batch_number: string;
  entry_date: string;
  cost_per_unit: number;
  initial_quantity: number;
  remaining_quantity: number;
  inventory_method: InventoryMethod;
  supplier_id?: string | null;
  purchase_order_id?: string | null;
  production_batch_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  branch_id: string;
  batch_id?: string | null;
  movement_type: string;
  quantity: number;
  unit_cost_at_time?: number | null;
  reason?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  user_id: string;
  notes?: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  client_id?: string | null;
  idempotency_key?: string | null;
  branch_id: string;
  user_id: string;
  customer_id?: string | null;
  sale_number: number;
  // subtotal_bruto: sum(unit_price × quantity) sin ningún descuento
  // discount_total: subtotal_bruto − total_final (derivado)
  // tax_total: IVA incluido en total_final
  // total: lo que se cobra realmente al cliente (con ajustes de método de pago)
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  status: OrderStatus;
  sync_status: SyncStatus;
  notes?: string | null;
  created_at: string;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  batch_id?: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes?: string | null;
  created_at: string;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  payment_method: PaymentMethod;
  amount: number;
  reference?: string | null;
  created_at: string;
}

export interface Customer extends Timestamps {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  document_type?: DocumentType | null;
  document_number?: string | null;
  type: CustomerType;
  credit_limit: number;
  current_debt: number;
  notes?: string | null;
  is_active: boolean;
}

export interface CashSession {
  id: string;
  branch_id: string;
  user_id: string;
  supervisor_id?: string | null;
  opening_amount: number;
  closing_amount?: number | null;
  expected_amount?: number | null;
  difference?: number | null;
  status: CashSessionStatus;
  notes?: string | null;
  opened_at: string;
  closed_at?: string | null;
}

export interface CashMovement {
  id: string;
  cash_session_id: string;
  user_id: string;
  type: CashMovementType;
  amount: number;
  description?: string | null;
  category?: string | null;
  receipt_image_url?: string | null;
  reference_id?: string | null;
  created_at: string;
}

export interface Recipe {
  id: string;
  product_id: string;
  name: string;
  yield_quantity: number;
  preparation_instructions?: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  ingredients?: RecipeIngredient[];
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_product_id: string;
  quantity: number;
  unit: string;
  waste_percentage: number;
  sort_order: number;
  created_at: string;
}

export interface ProductionBatch {
  id: string;
  recipe_id: string;
  branch_id: string;
  user_id: string;
  planned_quantity: number;
  actual_quantity?: number | null;
  waste_quantity?: number | null;
  total_cost?: number | null;
  unit_cost?: number | null;
  status: ProductionBatchStatus;
  notes?: string | null;
  planned_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Supplier extends Timestamps {
  id: string;
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  tax_id?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  is_active: boolean;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  branch_id: string;
  user_id: string;
  order_number: string;
  status: PurchaseOrderStatus;
  subtotal: number;
  tax_total: number;
  total: number;
  expected_delivery_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  received_quantity: number;
  total: number;
  notes?: string | null;
  created_at: string;
}

export interface TransferOrder {
  id: string;
  source_branch_id: string;
  destination_branch_id: string;
  requested_by: string;
  approved_by?: string | null;
  shipped_by?: string | null;
  received_by?: string | null;
  status: TransferStatus;
  notes?: string | null;
  requested_at: string;
  approved_at?: string | null;
  shipped_at?: string | null;
  received_at?: string | null;
  items?: TransferOrderItem[];
}

export interface TransferOrderItem {
  id: string;
  transfer_order_id: string;
  product_id: string;
  quantity: number;
  received_quantity?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  user_id?: string | null;
  branch_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  old_values?: string | null;
  new_values?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export interface SyncLog {
  id: string;
  branch_id: string;
  client_id?: string | null;
  server_id?: string | null;
  entity_type: string;
  operation: SyncOperation;
  status: SyncStatus;
  client_timestamp: string;
  server_timestamp?: string | null;
  conflict_data?: string | null;
  retry_count: number;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  branch_id: string;
  token_hash: string;
  refresh_token_hash?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  expires_at: string;
  last_activity_at: string;
  is_active: boolean;
  created_at: string;
}
