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
  image: string;
  code: string;
  ingredients: ProductIngredient[];
  elaborationDate?: string;
  durabilityDays?: number;
  groups?: ProductGroup[];
  isRawMaterial?: boolean;
  isProducible?: boolean;
  unit?: 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'dozen' | 'pack';
  supplier?: string;
  taxRate?: number;
  barcode?: string;
  attributes?: string;
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
  /**
   * Legacy: rótulo local calculado antes del change "Document Types". Se
   * mantiene por compat de UI/exportUtils mientras se termina de migrar todo
   * el frontend a `documentNumber`/`documentType` (el número REAL, correlativo
   * por tipo y sucursal, que devuelve el backend). NO usar para mostrar el
   * número de comprobante — usar `documentNumber`.
   */
  invoiceNumber: string;
  /**
   * Tipo de comprobante emitido (change "Document Types"). Default 'ticket'
   * si no se especifica al llamar `addSale`.
   */
  documentType?: 'ticket' | 'factura_a' | 'factura_b' | 'factura_c' | 'nota_credito' | 'remito' | 'presupuesto';
  /**
   * Número correlativo POR TIPO Y SUCURSAL (`document_sequences`, ver
   * `workers/api/src/lib/document-sequences.ts::nextSequence`). Es el número
   * real a mostrar/imprimir — NO confundir con `sale_number` (contador legacy
   * global de `sales`) ni con `invoiceNumber` (rótulo local pre-existente).
   * `undefined` hasta que la respuesta del servidor confirma la venta
   * (arquitectura offline-first: la venta se muestra localmente antes de que
   * la red responda) — ver `AppContext.addSale` y `syncSaleToD1`.
   */
  documentNumber?: string | number;
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
  paymentMethod: 'efectivo' | 'qr' | 'tarjeta' | 'transferencia';
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
  notes?: string;                    // observaciones del operador
  delivery_type?: 'aqui' | 'llevar'; // para llevar o retiran en local
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

export type UserRole = 'admin' | 'cajero' | 'panadero' | 'cocinero' | 'repartidor';

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
  realAmount?: number | null; // amount declared in counted cash; null = auto-closed without manual count
  discrepancy?: number | null; // realAmount - expectedAmount; null = auto-closed without manual count
  note?: string;
  status: 'open' | 'closed';
}

// ── Sync errors / status (sync-error-console) ────────────────────────────
export type SyncErrorCategory = 'network' | 'validation' | 'auth' | 'server';
export type SyncErrorStatus = 'pending' | 'retrying' | 'permanent_fail' | 'resolved';

export interface SyncError {
  id?: number;
  sale_id: string;
  category: SyncErrorCategory;
  message: string;
  payload: string;           // JSON string del sale payload
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
  resolved_at: string | null;
  status: SyncErrorStatus;
}

export type SyncLedState = 'synced' | 'error' | 'offline';

export interface SyncStatus {
  ledState: SyncLedState;
  pendingErrorCount: number;
  isSyncing: boolean;
  isOnline: boolean;
  lastSync: Date | null;
}

// ── SISTEMA DE SOLICITUDES UNIFICADO ──────────────────────────────────────

export type RequestType = 'supply' | 'production' | 'delivery' | 'task' | 'maintenance' | 'custom' | 'waste';
export type RequestStatus =
  | 'pending_approval' | 'approved' | 'rejected'
  | 'accepted' | 'in_progress' | 'completed'
  | 'reassignment_requested' | 'cancelled';
export type RequestPriority = 'low' | 'medium' | 'high';

/**
 * Metadata libre asociada a una solicitud. Para `type:'waste'` (mermas) el
 * backend transporta el vínculo con el lote local del POS y los datos del
 * descuento de stock que se aplica al aprobarse:
 *   - batch_id:   id LOCAL del ProductBatch en el cliente (client_batch_id).
 *   - product_id: producto asociado al lote.
 *   - quantity:   unidades a dar de baja.
 *   - reason:     motivo de la merma.
 */
export interface RequestMetadata {
  batch_id?: string;
  product_id?: string;
  quantity?: number;
  reason?: string;
  branch_id?: string;
  /** Multi-branch transfers (fase 3): presente cuando esta request type='delivery'
   *  fue creada automáticamente por el delivery bridge al aprobarse un transfer_order.
   *  Ver transfer_order_id/destination_branch_id en el contrato del backend. */
  transfer_order_id?: string;
  destination_branch_id?: string;
}

export interface ERPRequest {
  id: string;
  type: RequestType;
  title: string;
  description?: string;
  priority: RequestPriority;
  created_by_user_id?: string;
  created_by_role: string;
  assigned_role: string;
  assigned_user_id?: string;
  branch_id?: string;
  branch_name?: string; // join con branches
  is_permanent: 0 | 1;
  recurrence_days?: string; // JSON string "[1,2,3]"
  recurrence_time?: string;
  status: RequestStatus;
  accepted_by_user_id?: string;
  accepted_by_role?: string;
  is_optional_acceptance: 0 | 1;
  original_assigned_role?: string;
  admin_note?: string;
  rejection_reason?: string;
  reassignment_note?: string;
  cost_spent?: number;
  time_started?: string;
  time_completed?: string;
  duration_minutes?: number;
  incidents?: string;
  metadata?: RequestMetadata | null;
  created_at: string;
  updated_at: string;
}

export interface RequestActivity {
  id: string;
  request_id: string;
  user_id?: string;
  user_role?: string;
  user_name?: string;
  action: string;
  note?: string;
  created_at: string;
}

// ── MULTI-BRANCH TRANSFERS (fase 3) ───────────────────────────────────────
// Contrato acordado con el backend (transfers.ts, /api/v2/transfers) — ver
// sdd/multi-branch-transfers/design en Engram para el detalle de la máquina
// de estados y la transaccionalidad de stock.

export type TransferOrderStatus =
  | 'pending' | 'approved' | 'rejected'
  | 'in_transit' | 'received' | 'completed';

export interface TransferOrderItem {
  id: string;
  transfer_order_id: string;
  product_id: string;
  product_name?: string; // join, si el backend lo incluye
  quantity: number;
  received_quantity?: number;
}

export interface TransferOrder {
  id: string;
  source_branch_id: string;
  source_branch_name?: string;
  destination_branch_id: string;
  destination_branch_name?: string;
  status: TransferOrderStatus;
  notes?: string;
  rejection_reason?: string;
  admin_note?: string;
  requested_by?: string;
  approved_by?: string;
  shipped_by?: string;
  received_by?: string;
  delivery_request_id?: string;
  items: TransferOrderItem[];
  created_at: string;
  updated_at?: string;
}

export interface TransferRecommendation {
  product_id: string;
  product_name: string;
  from_branch_id: string;
  from_branch_name?: string;
  to_branch_id: string;
  to_branch_name?: string;
  suggested_qty: number;
}


