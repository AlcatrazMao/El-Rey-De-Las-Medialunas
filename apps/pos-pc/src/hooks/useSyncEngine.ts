import { NetworkMonitor, SyncEngine } from "@medialunas/sync-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { auth } from "../config/firebase";
import { salesQueueStore, syncErrorStore } from "../lib/idb";
import type { IDBSyncError } from "../lib/idb";
import { fetchWithAuth, getApi, isAccessTokenExpired, refreshAccessToken, API_URL as API_URL_CONST } from "../services/api";
import { calcNextRetry, classifyError, persistSyncError } from "../services/d1-sync";
import type { SalePayload } from "../services/d1-sync";
import { dbAdapter } from "../services/db-adapter";
import type { SyncStatus, SyncLedState } from "../types";

import { getSettings } from "./useSettings";


const API_URL = API_URL_CONST;

const MAX_AUTO_RETRY_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clamps a retry delay to [0, MAX_RETRY_DELAY_MS].
 *
 * Negative values (clock skew / stale next_retry_at) → 0 (fire immediately).
 * Values > 2^31 ms would overflow setTimeout and also fire immediately, which
 * could hammer the server. We cap at 5 minutes so retries always happen within
 * a reasonable window and the existing polling cycle picks up the rest.
 */
export function clampRetryDelay(delay: number): number {
  return Math.max(0, Math.min(delay, MAX_RETRY_DELAY_MS));
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
  // Proactive refresh: si el access_token ya venció, refrescamos ANTES de
  // iterar la cola en vez de dejar que cada item individual pague el costo
  // de un 401 + refresh (fetchWithAuth ya lo maneja reactivamente por-request,
  // pero para colas largas es más barato refrescar una sola vez de antemano).
  if (isAccessTokenExpired()) {
    await refreshAccessToken();
  }

  const pending = await salesQueueStore.getUnsynced();
  let flushed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/v1/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      } else if (response.status >= 400 && response.status < 500) {
        // 4xx → payload-side error (invalid data, unauthorized, etc.). Retrying
        // will never succeed, so mark permanently failed and stop pumping retries.
        let reason = `HTTP ${response.status}`;
        try { reason = (await response.text()) || reason; } catch { /* ignore body read errors */ }
        await salesQueueStore.markPermanentlyFailed(item.id, reason);
        failed++;
      } else {
        // 5xx → transient server error. Bump the counter and try again later.
        await salesQueueStore.incrementRetries(item.id);
        failed++;
      }
    } catch {
      // Network/transport failure → retry later, no permanent flag.
      await salesQueueStore.incrementRetries(item.id);
      failed++;
    }
  }
  return { flushed, failed };
}

export async function cleanupOldSynced(): Promise<void> {
  const settings = getSettings();
  // Guard: 0/negativo/NaN borraría todo el historial. Mínimo 1 día; default 7.
  const days = Math.max(1, Number(settings.sync.cleanupDays) || 7);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  await salesQueueStore.deleteOlderThan(cutoff);
}

export async function syncOnCashClose(triggerSync?: () => Promise<void> | void): Promise<void> {
  const settings = getSettings();
  if (!settings.sync.autoSyncOnClose) return;
  await flushSalesQueue();
  if (triggerSync) await triggerSync();
}

// ── Retry helpers (sync-error-console) ───────────────────────────────────
/**
 * Reintenta una venta usando su payload guardado. Devuelve el Response o lanza.
 * En éxito → marca el error como resuelto. En fallo → reclasifica + reagenda
 * o marca permanent_fail si llegó al cap.
 */
async function attemptRetry(errorId: number, opts?: { forceTokenRefresh?: boolean }): Promise<void> {
  const record = await syncErrorStore.get(errorId);
  if (!record || record.resolved_at !== null) return;

  let payloadParsed: Record<string, unknown>;
  try {
    payloadParsed = JSON.parse(record.payload);
  } catch {
    // Payload corrupto: no hay cómo reintentar. Marcamos permanent_fail.
    await syncErrorStore.incrementAttempt(errorId, null, "permanent_fail");
    return;
  }

  // Refresh forzado de Firebase id-token cuando el error original fue auth.
  if (opts?.forceTokenRefresh) {
    const user = auth.currentUser;
    if (user) {
      try {
        await user.getIdToken(true);
      } catch {
        // Si no se puede refrescar, dejamos pendiente sin auto-retry.
        await syncErrorStore.incrementAttempt(errorId, null, "pending");
        return;
      }
    }
  }

  // Validación mínima antes del cast: items debe ser un array.
  if (typeof payloadParsed.items !== 'object' || !Array.isArray(payloadParsed.items)) {
    await syncErrorStore.incrementAttempt(errorId, null, "permanent_fail");
    return;
  }

  try {
    await getApi().sales.create(payloadParsed as unknown as SalePayload);
    await syncErrorStore.markResolved(errorId);
  } catch (err) {
    const maybeResponse =
      err && typeof err === "object" && "response" in (err as Record<string, unknown>)
        ? ((err as { response?: Response }).response)
        : undefined;
    const category = classifyError(err, maybeResponse);
    const newAttempts = (record.attempts ?? 0) + 1;

    if (category === "network") {
      if (newAttempts >= MAX_AUTO_RETRY_ATTEMPTS) {
        await syncErrorStore.incrementAttempt(errorId, null, "permanent_fail");
      } else {
        const nextRetryAt = calcNextRetry(newAttempts);
        await syncErrorStore.incrementAttempt(errorId, nextRetryAt, "retrying");
      }
    } else {
      // validation / server / auth → no auto-reschedule. El admin decide.
      // (auth ya tuvo su intento con forceTokenRefresh si correspondía).
      await syncErrorStore.incrementAttempt(errorId, null, "pending");
    }
  }
}

export function useSyncEngine(isAuthenticated: boolean) {
  const engineRef = useRef<SyncEngine | null>(null);
  const syncingRef = useRef(false);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pendingErrorCount, setPendingErrorCount] = useState(0);

  // ── Scheduler de retries ──────────────────────────────────────────────
  const scheduleRetry = useCallback((errorId: number, nextRetryAt: string) => {
    // Cancelar timer previo si existe (evitamos duplicados).
    const prev = timersRef.current.get(errorId);
    if (prev) clearTimeout(prev);

    const rawDelay = new Date(nextRetryAt).getTime() - Date.now();
    const delay = clampRetryDelay(rawDelay);
    const timer = setTimeout(() => {
      timersRef.current.delete(errorId);
      void attemptRetry(errorId).then(async () => {
        // Después del intento, releemos el record para decidir reschedule.
        const updated = await syncErrorStore.get(errorId);
        if (!updated) return;
        if (updated.resolved_at !== null) return;
        if (updated.status === "retrying" && updated.next_retry_at) {
          scheduleRetry(errorId, updated.next_retry_at);
        }
      }).catch(() => {/* swallow */});
    }, delay);
    timersRef.current.set(errorId, timer);
  }, []);

  // ── Re-auth + retry (T2.5) ────────────────────────────────────────────
  // Para errores categoría=auth: refrescamos token y reintentamos UNA vez.
  // Si vuelve a fallar, queda pending sin schedule (el admin debe revisar).
  const retryAuthError = useCallback(async (errorId: number) => {
    await attemptRetry(errorId, { forceTokenRefresh: true });
  }, []);

  // Refrescar contador de pendientes (poll cada 5s + en demanda).
  const refreshPendingCount = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const pending = await syncErrorStore.getPending();
      if (!mountedRef.current) return;
      setPendingErrorCount(pending.length);
    } catch {
      // ignore
    }
  }, []);

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
      void refreshPendingCount();
    }
  }, [refreshPendingCount]);

  const syncOnCashCloseCb = useCallback(async () => {
    await syncOnCashClose(triggerSync);
  }, [triggerSync]);

  // ── Boot reschedule (T2.6) ────────────────────────────────────────────
  // Al montar, levantamos del store todos los errores network pendientes y
  // les programamos su próximo retry respetando su next_retry_at original.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    // Capturamos la ref al montar para que el cleanup pueda limpiar timers
    // sin warnings de stale-ref. En StrictMode (dev) el mount doble podría
    // dejar timers huérfanos del primer mount; este cleanup los cancela.
    const timers = timersRef.current;
    (async () => {
      try {
        const pending = await syncErrorStore.getPending();
        if (cancelled) return;
        for (const e of pending) {
          if (cancelled) break;
          if (!e.id) continue;
          if (e.category === "network" && e.status !== "permanent_fail" && e.next_retry_at) {
            scheduleRetry(e.id, e.next_retry_at);
          }
        }
      } catch {
        // store puede no estar listo aún
      }
      void refreshPendingCount();
    })();
    return () => {
      cancelled = true;
      // Cancelar todos los timers pendientes programados por este boot scan
      // para evitar duplicación si el componente se remonta (StrictMode dev).
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, [isAuthenticated, scheduleRetry, refreshPendingCount]);

  // Polling del contador (UI viva sin librerías reactivas extra).
  useEffect(() => {
    if (!isAuthenticated) return;
    mountedRef.current = true;
    const id = setInterval(() => { void refreshPendingCount(); }, 5_000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [isAuthenticated, refreshPendingCount]);

  // Listener `online`: cuando vuelve la red, intentamos retry inmediato
  // de todos los pending de categoría network.
  useEffect(() => {
    const onOnline = () => {
      void (async () => {
        const pending = await syncErrorStore.getPendingByCategory("network");
        for (const e of pending) {
          if (!e.id) continue;
          // Forzamos el next_retry a ahora — el scheduler corre inmediato.
          scheduleRetry(e.id, new Date().toISOString());
        }
      })();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [scheduleRetry]);

  // Limpieza de timers al desmontar.
  useEffect(() => {
    // Capturamos la ref al montar el effect — la ref es estable, pero ESLint
    // pide la copia explícita para evitar "changed by the time effect runs".
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
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
    void cleanupOldSynced();

    return () => {
      unsub();
      monitor.destroy();
      engine.destroy();
      engineRef.current = null;
    };
  }, [isAuthenticated, triggerSync]);

  // ── syncStatus derivado (T2.7) ────────────────────────────────────────
  // Prioridad: offline > error > synced
  const syncStatus: SyncStatus = useMemo(() => {
    let ledState: SyncLedState = "synced";
    if (!isOnline) ledState = "offline";
    else if (pendingErrorCount > 0) ledState = "error";
    return {
      ledState,
      pendingErrorCount,
      isSyncing,
      isOnline,
      lastSync,
    };
  }, [isOnline, pendingErrorCount, isSyncing, lastSync]);

  // ── API pública para consola admin ────────────────────────────────────
  const retryError = useCallback(async (errorId: number) => {
    // Reset attempts + next_retry_at = ahora (lo hace resetForRetry).
    await syncErrorStore.resetForRetry(errorId);
    const record = await syncErrorStore.get(errorId);
    if (!record) return;
    if (record.category === "auth") {
      await retryAuthError(errorId);
    } else {
      // Schedule inmediato.
      scheduleRetry(errorId, new Date().toISOString());
    }
    void refreshPendingCount();
  }, [retryAuthError, scheduleRetry, refreshPendingCount]);

  const retryAllNetwork = useCallback(async () => {
    const pending = await syncErrorStore.getPendingByCategory("network");
    for (const e of pending) {
      if (!e.id) continue;
      await syncErrorStore.resetForRetry(e.id);
      scheduleRetry(e.id, new Date().toISOString());
    }
    void refreshPendingCount();
  }, [scheduleRetry, refreshPendingCount]);

  return {
    engineRef,
    isOnline,
    isSyncing,
    lastSync,
    syncStatus,
    pendingErrorCount,
    triggerSync,
    enqueueSale,
    flushSalesQueue,
    syncOnCashClose: syncOnCashCloseCb,
    retryError,
    retryAllNetwork,
    refreshPendingCount,
  };
}

// Helpers para que la consola admin pueda persistir desde fuera del hook.
export { persistSyncError };
export type { IDBSyncError };
