import type { ApiClientInterface, DbClientInterface, PullChange } from "./types";

const PAGE_SIZE = 100;

const ENTITY_TABLE_MAP: Record<string, string> = {
  products: "products",
  categories: "categories",
  sales: "sales",
  inventory: "inventory",
  customers: "customers",
  cash_sessions: "cashSessions",
  production_recipes: "productionRecipes",
  production_batches: "productionBatches",
  suppliers: "suppliers",
  purchase_orders: "purchaseOrders",
  transfer_orders: "transferOrders",
};

function parseSyncLogToPullChange(entry: {
  id: string;
  entity_type: string;
  operation: string;
  entity_id?: string;
  data?: Record<string, unknown>;
  server_timestamp?: string;
}): PullChange {
  const data = entry.data ?? {};
  return {
    server_id: entry.id,
    entity_type: entry.entity_type,
    operation: entry.operation as "create" | "update" | "delete",
    version: 0,
    server_timestamp: entry.server_timestamp ?? new Date().toISOString(),
    data: {
      id: entry.entity_id ?? data.id,
      ...data,
    },
  };
}

export async function pullChanges(
  db: DbClientInterface,
  apiClient: ApiClientInterface,
  branchId: string,
  entityTypes?: string[],
): Promise<number> {
  let appliedCount = 0;
  let lastTimestamp: string | undefined;

  const storedTimestamp = await db.syncMeta.get("last_sync_timestamp");
  lastTimestamp = storedTimestamp ?? undefined;

  let hasMore = true;

  while (hasMore) {
    const response = await apiClient.sync.pull(lastTimestamp, entityTypes, branchId);

    if (!response.success || !response.data) {
      throw new Error("Pull request failed");
    }

    const { operations, server_timestamp } = response.data;

    for (const op of operations) {
      const change = parseSyncLogToPullChange(op);
      const tableName = ENTITY_TABLE_MAP[change.entity_type];
      const table = tableName ? db.getTable(tableName) : null;

      if (!table) {
        continue;
      }

      const id = typeof change.data.id === "string" ? change.data.id : change.server_id;

      switch (change.operation) {
        case "create":
        case "update": {
          const existing = await table.get(id);
          const merged = existing
            ? { ...existing, ...change.data, updated_at: change.server_timestamp }
            : { ...change.data, updated_at: change.server_timestamp };
          await table.put(merged);
          break;
        }
        case "delete":
          await table.delete(id);
          break;
      }

      appliedCount++;
    }

    lastTimestamp = server_timestamp;
    await db.syncMeta.set("last_sync_timestamp", server_timestamp);

    if (operations.length < PAGE_SIZE) {
      hasMore = false;
    }
  }

  return appliedCount;
}
