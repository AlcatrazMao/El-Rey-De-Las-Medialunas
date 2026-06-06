import type { SyncPushRequest, SyncPushResponse, SyncPullResponse } from "@medialunas/shared/types/api";
import type { ApiClient } from "../client";

export class SyncEndpoints {
  constructor(private client: ApiClient) {}

  async push(changes: SyncPushRequest["operations"], branchId: string): Promise<SyncPushResponse> {
    const body: SyncPushRequest = {
      operations: changes,
      branch_id: branchId,
    };
    return this.client.post<SyncPushResponse>("/api/v1/sync/push", body);
  }

  async pull(
    since?: string,
    entities?: string[],
    branchId?: string,
  ): Promise<SyncPullResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (since) params.last_sync_timestamp = since;
    if (branchId) params.branch_id = branchId;
    if (entities && entities.length > 0) {
      params.entity_types = entities.join(",");
    }
    return this.client.get<SyncPullResponse>("/api/v1/sync/pull", { params });
  }
}
