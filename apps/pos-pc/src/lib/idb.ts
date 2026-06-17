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

const DB_NAME = 'el-rey-idb';
const DB_VERSION = 1;
const STORE_BATCHES = 'batches';
const STORE_SALES_QUEUE = 'sales_queue';
const STORE_OFFERS = 'offers';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
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
    const db = await openDB();
    const store = tx(db, STORE_BATCHES, 'readwrite');
    await Promise.all(batches.map(b => request(store.put(b))));
  },

  async markSynced(id: string): Promise<void> {
    const db = await openDB();
    const store = tx(db, STORE_BATCHES, 'readwrite');
    const existing = (await request(store.get(id))) as IDBBatch | undefined;
    if (!existing) return;
    existing.synced = true;
    await request(store.put(existing));
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
    return all.filter(i => !i.synced);
  },

  async markSynced(id: string): Promise<void> {
    const db = await openDB();
    const store = tx(db, STORE_SALES_QUEUE, 'readwrite');
    const existing = (await request(store.get(id))) as IDBSaleQueueItem | undefined;
    if (!existing) return;
    existing.synced = true;
    await request(store.put(existing));
  },

  async incrementRetries(id: string): Promise<void> {
    const db = await openDB();
    const store = tx(db, STORE_SALES_QUEUE, 'readwrite');
    const existing = (await request(store.get(id))) as IDBSaleQueueItem | undefined;
    if (!existing) return;
    existing.retries += 1;
    await request(store.put(existing));
  },

  async getAll(): Promise<IDBSaleQueueItem[]> {
    const db = await openDB();
    return (await request(tx(db, STORE_SALES_QUEUE, 'readonly').getAll())) as IDBSaleQueueItem[];
  },

  async deleteOlderThan(cutoff: string): Promise<number> {
    const db = await openDB();
    const store = tx(db, STORE_SALES_QUEUE, 'readwrite');
    const all = (await request(store.getAll())) as IDBSaleQueueItem[];
    const toDelete = all.filter(i => i.synced && i.createdAt < cutoff);
    await Promise.all(toDelete.map(i => request(store.delete(i.id))));
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

  async markSynced(id: string): Promise<void> {
    const db = await openDB();
    const store = tx(db, STORE_OFFERS, 'readwrite');
    const existing = (await request(store.get(id))) as IDBOffer | undefined;
    if (!existing) return;
    existing.synced = true;
    await request(store.put(existing));
  },

  async getUnsynced(): Promise<IDBOffer[]> {
    const db = await openDB();
    const all = (await request(tx(db, STORE_OFFERS, 'readonly').getAll())) as IDBOffer[];
    return all.filter(o => !o.synced);
  },
};
