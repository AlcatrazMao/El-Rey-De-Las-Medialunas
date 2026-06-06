export interface SyncChange {
  client_id: string;
  entity_type: string;
  operation: "create" | "update" | "delete";
  version: number;
  client_timestamp: string;
  data: Record<string, unknown>;
}

export interface SyncResult {
  client_id: string;
  server_id?: string;
  status: "synced" | "conflict" | "error";
  error?: string;
  conflict_data?: Record<string, unknown>;
}

export interface PullChange {
  server_id: string;
  entity_type: string;
  operation: "create" | "update" | "delete";
  version: number;
  server_timestamp: string;
  data: Record<string, unknown>;
}

export interface PullResponse {
  changes: PullChange[];
  last_timestamp: string;
  has_more: boolean;
}

export type SyncStatus = "idle" | "syncing" | "error";

export type ConflictStrategy = "server_wins" | "client_wins" | "merge" | "manual";

export interface SyncEngineOptions {
  autoSync?: boolean;
  syncInterval?: number;
  retryDelay?: number;
  maxRetries?: number;
}

export interface PushSummary {
  total: number;
  synced: number;
  conflicted: number;
  failed: number;
  results: SyncResult[];
  pulledCount: number;
  error?: string;
}

export interface SyncEventMap {
  "sync:start": () => void;
  "sync:complete": (summary: PushSummary) => void;
  "sync:error": (error: Error) => void;
  conflict: (conflict: { entity_type: string; client_id: string; details: Record<string, unknown> }) => void;
  "pull:complete": (count: number) => void;
}

export interface DbClientInterface {
  syncQueue: {
    add(change: SyncChange): Promise<void>;
    remove(clientIds: string[]): Promise<void>;
    markFailed(clientId: string, error: string, retryCount: number): Promise<void>;
    getPending(limit?: number): Promise<SyncChange[]>;
    toArray(): Promise<SyncChange[]>;
    where(field: string): {
      equals(value: string): { toArray(): Promise<SyncChange[]>; delete(): Promise<void> };
      anyOf(values: string[]): { delete(): Promise<void> };
    };
    delete(): Promise<void>;
  };
  syncMeta: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
  };
  getTable(entityType: string): {
    put(data: Record<string, unknown>): Promise<void>;
    get(id: string): Promise<Record<string, unknown> | undefined>;
    delete(id: string): Promise<void>;
  };
}

export interface ApiClientInterface {
  sync: {
    push(
      operations: {
        client_id: string;
        entity_type: string;
        operation: "create" | "update" | "delete";
        data: Record<string, unknown>;
        client_timestamp: string;
      }[],
      branchId: string,
    ): Promise<{
      success: boolean;
      data?: { processed: number; failed: number };
    }>;
    pull(
      since?: string,
      entities?: string[],
      branchId?: string,
    ): Promise<{
      success: boolean;
      data?: {
        operations: {
          id: string;
          entity_type: string;
          operation: string;
          entity_id?: string;
          data?: Record<string, unknown>;
          server_timestamp?: string;
          conflict_data?: string;
        }[];
        server_timestamp: string;
      };
    }>;
  };
}
