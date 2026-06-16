import { NetworkMonitor, SyncEngine } from "@medialunas/sync-engine";
import { useCallback, useEffect, useRef, useState } from "react";


import { getApi } from "../services/api";
import { dbAdapter } from "../services/db-adapter";

import { getSettings } from "./useSettings";

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ||
  "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

export function useSyncEngine(isAuthenticated: boolean) {
  const engineRef = useRef<SyncEngine | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const triggerSync = useCallback(async () => {
    if (!engineRef.current) return;
    setIsSyncing(true);
    try {
      await engineRef.current.sync();
      setLastSync(new Date());
    } finally {
      setIsSyncing(false);
    }
  }, []);

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

    return () => {
      unsub();
      monitor.destroy();
      engine.destroy();
      engineRef.current = null;
    };
  }, [isAuthenticated, triggerSync]);

  return { engineRef, isOnline, isSyncing, lastSync, triggerSync };
}
