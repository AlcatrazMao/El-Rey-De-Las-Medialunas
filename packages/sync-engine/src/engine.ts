import { NetworkMonitor } from "./network-monitor";
import { pushChanges } from "./push";
import { pullChanges } from "./pull";
import { SyncQueue } from "./queue";
import type {
  SyncResult,
  PushSummary,
  DbClientInterface,
  ApiClientInterface,
  SyncEngineOptions,
  ConflictStrategy,
} from "./types";

export type { SyncResult, PushSummary, ConflictStrategy, SyncEngineOptions };

export interface SyncEngineConfig {
  db: DbClientInterface;
  apiClient: ApiClientInterface;
  branchId: string;
  healthCheckUrl?: string;
  options?: SyncEngineOptions;
}

export class SyncEngine {
  private db: DbClientInterface;
  private apiClient: ApiClientInterface;
  private branchId: string;
  private options: Required<SyncEngineOptions>;
  private networkMonitor: NetworkMonitor;
  private syncQueue: SyncQueue;
  private isRunning = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SyncEngineConfig) {
    this.db = config.db;
    this.apiClient = config.apiClient;
    this.branchId = config.branchId;
    this.options = {
      autoSync: config.options?.autoSync ?? true,
      syncInterval: config.options?.syncInterval ?? 30000,
      retryDelay: config.options?.retryDelay ?? 1000,
      maxRetries: config.options?.maxRetries ?? 3,
    };

    this.networkMonitor = new NetworkMonitor(config.healthCheckUrl);
    this.syncQueue = new SyncQueue(this.db);
  }

  get isOnline(): boolean {
    return this.networkMonitor.isOnline;
  }

  async sync(): Promise<PushSummary | null> {
    if (this.isRunning) {
      return null;
    }

    if (!this.networkMonitor.isOnline) {
      return null;
    }

    this.isRunning = true;

    try {
      const pushResults = await pushChanges(this.db, this.apiClient, this.branchId);

      const pulledCount = await pullChanges(this.db, this.apiClient, this.branchId);

      const synced = pushResults.filter((r) => r.status === "synced").length;
      const conflicted = pushResults.filter((r) => r.status === "conflict").length;
      const failed = pushResults.filter((r) => r.status === "error").length;

      return {
        total: pushResults.length,
        synced,
        conflicted,
        failed,
        results: pushResults,
        pulledCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown sync error";

      return {
        total: 0,
        synced: 0,
        conflicted: 0,
        failed: 0,
        results: [],
        pulledCount: 0,
        error: errorMessage,
      };
    } finally {
      this.isRunning = false;
    }
  }

  startAutoSync(): void {
    this.stopAutoSync();

    this.networkMonitor.onStatusChange((isOnline) => {
      if (isOnline) {
        void this.sync();
      }
    });

    if (this.options.autoSync) {
      this.syncTimer = setInterval(() => {
        void this.sync();
      }, this.options.syncInterval);
    }
  }

  stopAutoSync(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  destroy(): void {
    this.stopAutoSync();
    this.networkMonitor.destroy();
  }
}
