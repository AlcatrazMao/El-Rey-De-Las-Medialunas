import { NetworkMonitor, SyncEngine } from "@medialunas/sync-engine";
import { useCallback, useEffect, useRef, useState } from "react";


import { salesQueueStore } from "../lib/idb";
import { getApi } from "../services/api";
import { dbAdapter } from "../services/db-adapter";

import { getSettings } from "./useSettings";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

function getToken(): string {
  return localStorage.getItem("firebase_token") || "";
}

function detectOrigin(): "web" | "local" {
  return window.location.hostname === "localhost" ? "local" : "web";
}

export async function enqueueSale(saleData: Record<string, unknown>): Promise<void> {
  await salesQueueStore.enqueue({
    id: String(saleData.id ?? `sale_${Date.now()}`),
    saleData,
    createdAt: new Date().toISOString(),
    origin: detectOrigin(),
    synced: false,
  });
}

export async function flushSalesQueue(): Promise<{ flushed: number; failed: number }> {
  const pending = await salesQueueStore.getUnsynced();
  let flushed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const response = await fetch(`${API_URL}/api/v1/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          branch_id: getSettings().business.branchId,
          operations: [
            {
              client_id: item.id,
              entity_type: "sale",
              operation: "create",
              data: {
                ...item.saleData,
                origin: item.origin,
                client_timestamp: item.createdAt,
              },
              client_timestamp: item.createdAt,
            },
          ],
        }),
      });
      if (response.ok) {
        await salesQueueStore.markSynced(item.id);
        flushed++;
      } else {
        await salesQueueStore.incrementRetries(item.id);
        failed++;
      }
    } catch {
      await salesQueueStore.incrementRetries(item.id);
      failed++;
    }
  }
  return { flushed, failed };
}

export async function cleanupOldSynced(): Promise<void> {
  const settings = getSettings();
  const cutoff = new Date(Date.now() - settings.sync.cleanupDays * 86400000).toISOString();
  await salesQueueStore.deleteOlderThan(cutoff);
}

export async function syncOnCashClose(triggerSync?: () => Promise<void> | void): Promise<void> {
  const settings = getSettings();
  if (!settings.sync.autoSyncOnClose) return;
  await flushSalesQueue();
  if (triggerSync) await triggerSync();
}

export function useSyncEngine(isAuthenticated: boolean) {
  const engineRef = useRef<SyncEngine | null>(null);
  const syncingRef = useRef(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const triggerSync = useCallback(async () => {
    if (!engineRef.current || syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      await engineRef.current.sync();
      setLastSync(new Date());
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const syncOnCashCloseCb = useCallback(async () => {
    await syncOnCashClose(triggerSync);
  }, [triggerSync]);

  useEffect(() => {
    if (!isAuthenticated) {
      engineRef.current?.destroy();
      engineRef.current = null;
      return;
    }

    const branchId = getSettings().business.branchId;
    const healthCheckUrl = `${API_URL}/api/v1/health`;

    const monitor = new NetworkMonitor(healthCheckUrl);
    setIsOnline(monitor.isOnline);
    const unsub = monitor.onStatusChange((online) => setIsOnline(online));

    const engine = new SyncEngine({
      db: dbAdapter,
      apiClient: {
        sync: {
          push: (operations, bid) => getApi().sync.push(operations, bid),
          pull: (since, entities, bid) => getApi().sync.pull(since, entities, bid),
        },
      },
      branchId,
      healthCheckUrl,
      options: {
        autoSync: true,
        syncInterval: 30_000,
        retryDelay: 2_000,
        maxRetries: 3,
      },
    });

    engine.startAutoSync();
    engineRef.current = engine;

    void triggerSync();
    void cleanupOldSynced();

    return () => {
      unsub();
      monitor.destroy();
      engine.destroy();
      engineRef.current = null;
    };
  }, [isAuthenticated, triggerSync]);

  return {
    engineRef,
    isOnline,
    isSyncing,
    lastSync,
    triggerSync,
    enqueueSale,
    flushSalesQueue,
    syncOnCashClose: syncOnCashCloseCb,
  };
}
