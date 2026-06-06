export interface LocalProduct {
  id: string;
  code: string;
  barcode?: string;
  name: string;
  description?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  categoryId: string;
  branchId: string;
  unit: string;
  price: number;
  taxRate: number;
  isActive: boolean;
  updatedAt: string;
}

export interface LocalCategory {
  id: string;
  parentId?: string;
  branchId: string;
  name: string;
  icon?: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

export interface LocalProductAlias {
  id: string;
  productId: string;
  alias: string;
}

export interface LocalSale {
  id: string;
  clientId?: string;
  branchId: string;
  userId: string;
  customerId?: string;
  saleNumber: number;
  items: LocalSaleItem[];
  payments: LocalSalePayment[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  status: 'completed' | 'voided' | 'refunded';
  syncStatus: 'pending' | 'synced' | 'failed';
  notes?: string;
  createdAt: string;
}

export interface LocalSaleItem {
  id: string;
  saleId: string;
  productId: string;
  batchId?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  total: number;
  notes?: string;
}

export interface LocalSalePayment {
  id: string;
  saleId: string;
  paymentMethod: string;
  amount: number;
  reference?: string;
}

export interface LocalInventory {
  productId: string;
  branchId: string;
  currentQuantity: number;
  reservedQuantity: number;
  updatedAt: string;
}

export interface LocalCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: string;
  creditLimit: number;
  currentDebt: number;
}

export interface LocalCashSession {
  id: string;
  branchId: string;
  userId: string;
  openingAmount: number;
  status: 'open' | 'closing' | 'closed';
  openedAt: string;
  closedAt?: string;
}

export interface SyncQueueItem {
  id?: number;
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  version: number;
  clientTimestamp: string;
  data: unknown;
  status: 'pending' | 'processing' | 'failed';
  retryCount: number;
}

export interface SyncMeta {
  key: string;
  value: string;
}

export interface HeldCart {
  id: string;
  name: string;
  items: LocalSaleItem[];
  createdAt: string;
}
