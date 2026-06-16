import { db } from "@medialunas/db-client";
import type { DbClientInterface, SyncChange } from "@medialunas/sync-engine";

function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[snakeToCamelKey(k)] = v;
  }
  return result;
}

function itemToChange(item: {
  entityId: string;
  entityType: string;
  operation: "create" | "update" | "delete";
  version: number;
  clientTimestamp: string;
  data: unknown;
}): SyncChange {
  return {
    client_id: item.entityId,
    entity_type: item.entityType,
    operation: item.operation,
    version: item.version,
    client_timestamp: item.clientTimestamp,
    data: (item.data ?? {}) as Record<string, unknown>,
  };
}

export const dbAdapter: DbClientInterface = {
  syncQueue: {
    async add(change) {
      await db.syncQueue.add({
        entityType: change.entity_type,
        entityId: change.client_id,
        operation: change.operation,
        version: change.version,
        clientTimestamp: change.client_timestamp,
        data: change.data,
        status: "pending",
        retryCount: 0,
      });
    },

    async remove(clientIds) {
      if (clientIds.length === 0) return;
      await db.syncQueue.where("entityId").anyOf(clientIds).delete();
    },

    async markFailed(clientId, _error, retryCount) {
      const items = await db.syncQueue.where("entityId").equals(clientId).toArray();
      for (const item of items) {
        if (item.id !== undefined) {
          await db.syncQueue.update(item.id, { status: "failed", retryCount });
        }
      }
    },

    async getPending(limit = 50) {
      const items = await db.syncQueue.where("status").equals("pending").limit(limit).toArray();
      return items.map(itemToChange);
    },

    async toArray() {
      const items = await db.syncQueue.toArray();
      return items.map(itemToChange);
    },

    where(field) {
      const fieldMap: Record<string, string> = {
        entity_type: "entityType",
        client_id: "entityId",
        status: "status",
      };
      const dexieField = fieldMap[field] ?? field;
      return {
        equals(value) {
          return {
            async toArray() {
              const items = await db.syncQueue.where(dexieField).equals(value).toArray();
              return items.map(itemToChange);
            },
            async delete() {
              await db.syncQueue.where(dexieField).equals(value).delete();
            },
          };
        },
        anyOf(values) {
          return {
            async delete() {
              await db.syncQueue.where(dexieField).anyOf(values).delete();
            },
          };
        },
      };
    },

    async delete() {
      await db.syncQueue.clear();
    },
  },

  syncMeta: {
    async get(key) {
      const item = await db.syncMeta.get(key);
      return item?.value;
    },
    async set(key, value) {
      await db.syncMeta.put({ key, value });
    },
  },

  getTable(entityType) {
    const tableMap: Record<string, { put: (d: Record<string, unknown>) => Promise<unknown>; get: (id: string) => Promise<unknown>; delete: (id: string) => Promise<void> }> = {
      products: {
        put: (d) => db.products.put(snakeToCamel(d) as never),
        get: (id) => db.products.get(id) as Promise<unknown>,
        delete: (id) => db.products.delete(id),
      },
      categories: {
        put: (d) => db.categories.put(snakeToCamel(d) as never),
        get: (id) => db.categories.get(id) as Promise<unknown>,
        delete: (id) => db.categories.delete(id),
      },
      sales: {
        put: (d) => db.sales.put(snakeToCamel(d) as never),
        get: (id) => db.sales.get(id) as Promise<unknown>,
        delete: (id) => db.sales.delete(id),
      },
      customers: {
        put: (d) => db.customers.put(snakeToCamel(d) as never),
        get: (id) => db.customers.get(id) as Promise<unknown>,
        delete: (id) => db.customers.delete(id),
      },
      cashSessions: {
        put: (d) => db.cashSessions.put(snakeToCamel(d) as never),
        get: (id) => db.cashSessions.get(id) as Promise<unknown>,
        delete: (id) => db.cashSessions.delete(id),
      },
      inventory: {
        put: async (d) => {
          const camel = snakeToCamel(d);
          await db.inventory.put(camel as never);
        },
        get: async (id) => {
          const all = await db.inventory.toArray();
          return all.find((i) => i.productId === id) ?? undefined;
        },
        delete: async (id) => {
          await db.inventory.where("productId").equals(id).delete();
        },
      },
    };

    const table = tableMap[entityType];
    if (!table) {
      return {
        put: async () => {},
        get: async () => undefined,
        delete: async () => {},
      };
    }
    return {
      put: (d) => table.put(d).then(() => {}),
      get: (id) => table.get(id) as Promise<Record<string, unknown> | undefined>,
      delete: (id) => table.delete(id),
    };
  },
};
