import type { SyncChange, DbClientInterface } from "./types";

export class SyncQueue {
  constructor(private db: DbClientInterface) {}

  async addToSyncQueue(change: SyncChange): Promise<void> {
    await this.db.syncQueue.add(change);
  }

  async removeFromSyncQueue(clientIds: string[]): Promise<void> {
    if (clientIds.length === 0) return;
    await this.db.syncQueue.where("client_id").anyOf(clientIds).delete();
  }

  async markFailed(clientId: string, error: string, retryCount: number): Promise<void> {
    await this.db.syncQueue.markFailed(clientId, error, retryCount);
  }

  async getPendingChanges(limit?: number): Promise<SyncChange[]> {
    return this.db.syncQueue.getPending(limit);
  }

  async clearQueue(): Promise<void> {
    await this.db.syncQueue.delete();
  }
}
