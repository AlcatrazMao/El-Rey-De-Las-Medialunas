import type { Dexie } from 'dexie';

export function migrateV1(db: Dexie): void {
  db.version(1).stores({
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
