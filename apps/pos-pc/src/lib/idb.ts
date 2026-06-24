import type { SyncErrorCategory, SyncErrorStatus } from '../types';

export interface IDBBatch {
  id: string;
  productId: string;
  productName?: string;
  batchNumber: string;
  elaborationDate: string;
  expiryDate?: string;
  durabilityDays?: number;
  stock: number;
  initialQuantity: number;
  costPerUnit: number;
  status: 'active' | 'withdrawn' | 'sold_out' | 'expired';
  notes?: string;
  synced: boolean;
  updatedAt: string;
  origin: 'web' | 'local';
}

export interface IDBSaleQueueItem {
  id: string;
  saleData: Record<string, unknown>;
  createdAt: string;
  origin: 'web' | 'local';
  synced: boolean;
  retries: number;
  // 4xx payload errors must not be retried forever — the flush loop skips
  // items with this flag set. Optional for backward compat with old entries.
  permanentlyFailed?: boolean;
  permanentFailReason?: string;
}

export interface IDBOffer {
  id: string;
  name: string;
  discountPercent: number;
  batchIds: string[];
  productIds: string[];
  startsAt: string;
  endsAt?: string;
  status: 'active' | 'expired' | 'cancelled';
  notes?: string;
  createdAt: string;
  synced: boolean;
}

// sync-error-console: persistent log of failed sale syncs
export interface IDBSyncError {
  id?: number; // auto-increment
  sale_id: string;
  category: SyncErrorCategory;
  message: string;
  payload: string;            // JSON-stringified sale payload
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
  resolved_at: string | null;
  status: SyncErrorStatus;
}

const DB_NAME = 'el-rey-idb';
// Bumped from 1 → 2 to add the `sync_errors` object store.
const DB_VERSION = 2;
const STORE_BATCHES = 'batches';
const STORE_SALES_QUEUE = 'sales_queue';
const STORE_OFFERS = 'offers';
const STORE_SYNC_ERRORS = 'sync_errors';

let dbPromise: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BATCHES)) {
          const s = db.createObjectStore(STORE_BATCHES, { keyPath: 'id' });
          s.createIndex('productId', 'productId', { unique: false });
          s.createIndex('expiryDate', 'expiryDate', { unique: false });
          s.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SALES_QUEUE)) {
          const s = db.createObjectStore(STORE_SALES_QUEUE, { keyPath: 'id' });
          s.createIndex('synced', 'synced', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_OFFERS)) {
          const s = db.createObjectStore(STORE_OFFERS, { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SYNC_ERRORS)) {
          const s = db.createObjectStore(STORE_SYNC_ERRORS, { keyPath: 'id', autoIncrement: true });
          s.createIndex('sale_id', 'sale_id', { unique: false });
          s.createIndex('category', 'category', { unique: false });
          s.createIndex('resolved_at', 'resolved_at', { unique: false });
          s.createIndex('next_retry_at', 'next_retry_at', { unique: false });
        }
      } catch (e) {
        // Bug 5 fix: reject the promise so callers don't hang forever
        dbPromise = null;
        req.transaction?.abort();
        reject(e);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IDB upgrade blocked by another tab'));
    };
  });
  return dbPromise;
}

export const batchStore = {
  async getAll(filters?: { status?: string }): Promise<IDBBatch[]> {
    const db = await openDB();
    const all = await request(tx(db, STORE_BATCHES, 'readonly').getAll());
    const list = all as IDBBatch[];
    if (filters?.status) return list.filter(b => b.status === filters.status);
    return list;
  },

  async getExpiring(withinHours: number): Promise<IDBBatch[]> {
    const db = await openDB();
    const all = (await request(tx(db, STORE_BATCHES, 'readonly').getAll())) as IDBBatch[];
    const limit = Date.now() + withinHours * 3600 * 1000;
    return all.filter(b => {
      if (!b.expiryDate) return false;
      if (b.status !== 'active') return false;
      const t = new Date(b.expiryDate).getTime();
      return !Number.isNaN(t) && t <= limit;
    });
  },

  async put(batch: IDBBatch): Promise<void> {
    const db = await openDB();
    await request(tx(db, STORE_BATCHES, 'readwrite').put(batch));
  },

  async putMany(batches: IDBBatch[]): Promise<void> {
    if (batches.length === 0) return;
    const db = await openDB();
    // Bug 4 fix: wait for txn.oncomplete, not just individual request onsuccess.
    // Individual puts resolving does NOT guarantee the transaction committed
    // (e.g. disk-full errors surface only at commit time).
    await new Promise<void>((res, rej) => {
      const txn = db.transaction(STORE_BATCHES, 'readwrite');
      txn.oncomplete = () => res();
      txn.onerror = () => rej(txn.error);
      txn.onabort = () => rej(new Error('Transaction aborted'));
      const store = txn.objectStore(STORE_BATCHES);
      batches.forEach(b => store.put(b)); // fire all puts synchronously; no await needed
    });
  },

  async markSynced(id: string): Promise<boolean> {
    const db = await openDB();
    // Bug fix: IDB transactions auto-commit when the event loop yields after an
    // await. Issuing get() then put() with an await between them throws
    // TransactionInactiveError. We must issue both requests synchronously inside
    // the same transaction via callbacks, or use separate transactions.
    // Returns true si efectivamente actualizó el registro; false si el id no
    // existía (antes era un silent miss — el caller no podía distinguirlo).
    return new Promise<boolean>((resolve, reject) => {
      const txn = db.transaction(STORE_BATCHES, 'readwrite');
      const store = txn.objectStore(STORE_BATCHES);
      const getReq = store.get(id);
      let updated = false;
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBBatch | undefined;
        if (!existing) return; // txn auto-commits sin writes; updated queda en false
        existing.synced = true;
        store.put(existing); // fire synchronously; txn.oncomplete confirms commit
        updated = true;
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve(updated);
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async getUnsynced(): Promise<IDBBatch[]> {
    const db = await openDB();
    const all = (await request(tx(db, STORE_BATCHES, 'readonly').getAll())) as IDBBatch[];
    return all.filter(b => !b.synced);
  },
};

export const salesQueueStore = {
  async enqueue(item: Omit<IDBSaleQueueItem, 'retries'>): Promise<void> {
    const db = await openDB();
    const full: IDBSaleQueueItem = { ...item, retries: 0 };
    await request(tx(db, STORE_SALES_QUEUE, 'readwrite').put(full));
  },

  async getUnsynced(): Promise<IDBSaleQueueItem[]> {
    const db = await openDB();
    const all = (await request(tx(db, STORE_SALES_QUEUE, 'readonly').getAll())) as IDBSaleQueueItem[];
    // Skip items the server already rejected as invalid (4xx) — retrying them
    // would loop forever inflating the retries counter without any chance of
    // success until the admin manually fixes the payload.
    return all.filter(i => !i.synced && !i.permanentlyFailed);
  },

  async markPermanentlyFailed(id: string, reason?: string): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SALES_QUEUE, 'readwrite');
      const store = txn.objectStore(STORE_SALES_QUEUE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSaleQueueItem | undefined;
        if (!existing) return;
        existing.permanentlyFailed = true;
        if (reason) existing.permanentFailReason = reason;
        store.put(existing);
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async markSynced(id: string): Promise<boolean> {
    const db = await openDB();
    // Bug fix: same TransactionInactiveError pattern as batchStore.markSynced.
    // Devuelve true si actualizó el item; false si el id no existía (antes era
    // silent miss y el caller creía haber marcado un item inexistente).
    return new Promise<boolean>((resolve, reject) => {
      const txn = db.transaction(STORE_SALES_QUEUE, 'readwrite');
      const store = txn.objectStore(STORE_SALES_QUEUE);
      const getReq = store.get(id);
      let updated = false;
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSaleQueueItem | undefined;
        if (!existing) return;
        existing.synced = true;
        store.put(existing);
        updated = true;
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve(updated);
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async incrementRetries(id: string): Promise<void> {
    const db = await openDB();
    // Bug fix: same TransactionInactiveError pattern as markSynced.
    // Fix 5: si después del incremento retries >= 10, marcar permanentlyFailed
    // automáticamente. Ventas con error 4xx de lo contrario acumularían miles
    // de retries sin posibilidad de éxito hasta intervención manual.
    const MAX_RETRIES = 10;
    return new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SALES_QUEUE, 'readwrite');
      const store = txn.objectStore(STORE_SALES_QUEUE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSaleQueueItem | undefined;
        if (!existing) return;
        existing.retries += 1;
        if (existing.retries >= MAX_RETRIES) {
          existing.permanentlyFailed = true;
          existing.permanentFailReason = 'MAX_RETRIES_EXCEEDED';
        }
        store.put(existing);
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async getAll(): Promise<IDBSaleQueueItem[]> {
    const db = await openDB();
    return (await request(tx(db, STORE_SALES_QUEUE, 'readonly').getAll())) as IDBSaleQueueItem[];
  },

  async deleteOlderThan(cutoff: string): Promise<number> {
    const db = await openDB();
    // Bug fix: original code did getAll() then delete() on the same txn with an
    // await between, causing TransactionInactiveError. Split into two txns:
    // a readonly read (auto-commits safely) and a readwrite delete batch.
    const all = await new Promise<IDBSaleQueueItem[]>((resolve, reject) => {
      const txn = db.transaction(STORE_SALES_QUEUE, 'readonly');
      const req = txn.objectStore(STORE_SALES_QUEUE).getAll();
      req.onsuccess = () => resolve(req.result as IDBSaleQueueItem[]);
      req.onerror = () => reject(req.error);
      txn.onerror = () => reject(txn.error);
    });
    const cutoffMs = new Date(cutoff).getTime();
    const toDelete = all.filter(i => {
      if (!i.synced) return false;
      if (!i.createdAt || typeof i.createdAt !== 'string') return false;
      const createdMs = new Date(i.createdAt).getTime();
      return !Number.isNaN(createdMs) && createdMs < cutoffMs;
    });
    if (toDelete.length === 0) return 0;
    await new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SALES_QUEUE, 'readwrite');
      const store = txn.objectStore(STORE_SALES_QUEUE);
      // Fire all deletes synchronously, then wait for txn.oncomplete to ensure
      // the commit (not just individual request success) actually succeeded.
      toDelete.forEach(i => store.delete(i.id));
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
    return toDelete.length;
  },
};

export const offerStore = {
  async getAll(): Promise<IDBOffer[]> {
    const db = await openDB();
    return (await request(tx(db, STORE_OFFERS, 'readonly').getAll())) as IDBOffer[];
  },

  async put(offer: IDBOffer): Promise<void> {
    const db = await openDB();
    await request(tx(db, STORE_OFFERS, 'readwrite').put(offer));
  },

  async markSynced(id: string): Promise<boolean> {
    const db = await openDB();
    // Bug fix: same TransactionInactiveError pattern as batchStore.markSynced.
    // Devuelve true si actualizó el item; false si el id no existía.
    return new Promise<boolean>((resolve, reject) => {
      const txn = db.transaction(STORE_OFFERS, 'readwrite');
      const store = txn.objectStore(STORE_OFFERS);
      const getReq = store.get(id);
      let updated = false;
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBOffer | undefined;
        if (!existing) return;
        existing.synced = true;
        store.put(existing);
        updated = true;
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve(updated);
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async getUnsynced(): Promise<IDBOffer[]> {
    const db = await openDB();
    const all = (await request(tx(db, STORE_OFFERS, 'readonly').getAll())) as IDBOffer[];
    return all.filter(o => !o.synced);
  },
};

// ── sync_errors store ────────────────────────────────────────────────────
// Persistent ledger of D1 sale-sync failures. Used by:
//   • useSyncEngine — schedules backoff retries
//   • SyncErrorConsole — admin-only UI to inspect/edit/retry
//   • SyncLed — drives the yellow/red status indicator
export const syncErrorStore = {
  async add(err: Omit<IDBSyncError, 'id'>): Promise<number> {
    const db = await openDB();
    const id = await request(
      tx(db, STORE_SYNC_ERRORS, 'readwrite').add(err as IDBSyncError),
    );
    return Number(id);
  },

  async put(err: IDBSyncError): Promise<void> {
    const db = await openDB();
    await request(tx(db, STORE_SYNC_ERRORS, 'readwrite').put(err));
  },

  async getAll(): Promise<IDBSyncError[]> {
    const db = await openDB();
    return (await request(tx(db, STORE_SYNC_ERRORS, 'readonly').getAll())) as IDBSyncError[];
  },

  async getPending(): Promise<IDBSyncError[]> {
    const all = await this.getAll();
    return all.filter(e => e.resolved_at === null);
  },

  async getPendingByCategory(category: IDBSyncError['category']): Promise<IDBSyncError[]> {
    const all = await this.getAll();
    return all.filter(e => e.resolved_at === null && e.category === category);
  },

  async findBySaleId(saleId: string): Promise<IDBSyncError | undefined> {
    const all = await this.getAll();
    return all.find(e => e.sale_id === saleId && e.resolved_at === null);
  },

  async get(id: number): Promise<IDBSyncError | undefined> {
    const db = await openDB();
    return (await request(tx(db, STORE_SYNC_ERRORS, 'readonly').get(id))) as IDBSyncError | undefined;
  },

  async markResolved(id: number): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SYNC_ERRORS, 'readwrite');
      const store = txn.objectStore(STORE_SYNC_ERRORS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSyncError | undefined;
        if (!existing) return;
        existing.resolved_at = new Date().toISOString();
        existing.status = 'resolved';
        store.put(existing);
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async resetForRetry(id: number): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SYNC_ERRORS, 'readwrite');
      const store = txn.objectStore(STORE_SYNC_ERRORS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSyncError | undefined;
        if (!existing) return;
        existing.attempts = 0;
        existing.next_retry_at = new Date().toISOString();
        existing.status = 'pending';
        store.put(existing);
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async updatePayload(id: number, payload: string): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SYNC_ERRORS, 'readwrite');
      const store = txn.objectStore(STORE_SYNC_ERRORS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSyncError | undefined;
        if (!existing) return;
        existing.payload = payload;
        store.put(existing);
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },

  async incrementAttempt(id: number, nextRetryAt: string | null, status: SyncErrorStatus): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const txn = db.transaction(STORE_SYNC_ERRORS, 'readwrite');
      const store = txn.objectStore(STORE_SYNC_ERRORS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as IDBSyncError | undefined;
        if (!existing) return;
        existing.attempts += 1;
        existing.next_retry_at = nextRetryAt;
        existing.status = status;
        store.put(existing);
      };
      getReq.onerror = () => reject(getReq.error);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(new Error('Transaction aborted'));
    });
  },
};
