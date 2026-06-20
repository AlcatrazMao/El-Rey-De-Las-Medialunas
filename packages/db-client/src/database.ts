import Dexie, { type Table } from 'dexie';

import type { LocalProduct, LocalCategory, LocalProductAlias, LocalSale, LocalSaleItem, LocalSalePayment, LocalInventory, LocalCustomer, LocalCashSession, SyncQueueItem, SyncMeta, HeldCart } from './schema';

export class MedialunasDB extends Dexie {
  products!: Table<LocalProduct, string>;
  categories!: Table<LocalCategory, string>;
  productAliases!: Table<LocalProductAlias, string>;
  sales!: Table<LocalSale, string>;
  saleItems!: Table<LocalSaleItem, string>;
  salePayments!: Table<LocalSalePayment, string>;
  inventory!: Table<LocalInventory, [string, string]>;
  customers!: Table<LocalCustomer, string>;
  cashSessions!: Table<LocalCashSession, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  syncMeta!: Table<SyncMeta, string>;
  heldCarts!: Table<HeldCart, string>;

  constructor() {
    super('MedialunasDB');
    this.version(1).stores({
      products: 'id, code, barcode, categoryId, branchId, isActive',
      categories: 'id, parentId, branchId, isActive',
      productAliases: 'id, productId, alias',
      sales: 'id, branchId, userId, customerId, syncStatus, createdAt',
      saleItems: 'id, saleId, productId',
      salePayments: 'id, saleId, paymentMethod',
      inventory: '[productId+branchId], productId, branchId',
      customers: 'id, name, phone',
      cashSessions: 'id, branchId, userId, status',
      syncQueue: '++id, entityType, entityId, status, retryCount',
      syncMeta: 'key',
      heldCarts: 'id, createdAt',
    });
  }
}

export const db = new MedialunasDB();
