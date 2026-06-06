import type { SyncResult, ApiClientInterface, DbClientInterface } from "./types";

const BATCH_SIZE = 50;

export async function pushChanges(
  db: DbClientInterface,
  apiClient: ApiClientInterface,
  branchId: string,
): Promise<SyncResult[]> {
  const allResults: SyncResult[] = [];
  let hasMore = true;

  while (hasMore) {
    const batch = await db.syncQueue.getPending(BATCH_SIZE);

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    const operations = batch.map((change) => ({
      client_id: change.client_id,
      entity_type: change.entity_type,
      operation: change.operation,
      data: change.data,
      client_timestamp: change.client_timestamp,
    }));

    try {
      const response = await apiClient.sync.push(operations, branchId);

      if (!response.success || !response.data) {
        for (const change of batch) {
          allResults.push({
            client_id: change.client_id,
            status: "error",
            error: "Push request failed",
          });
          await db.syncQueue.markFailed(change.client_id, "Push request failed", 0);
        }
      } else {
        for (const change of batch) {
          allResults.push({
            client_id: change.client_id,
            status: "synced",
          });
        }

        const syncedIds = batch.map((c) => c.client_id);
        await db.syncQueue.remove(syncedIds);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      for (const change of batch) {
        allResults.push({
          client_id: change.client_id,
          status: "error",
          error: errorMessage,
        });
        await db.syncQueue.markFailed(change.client_id, errorMessage, 0);
      }
    }

    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  return allResults;
}
