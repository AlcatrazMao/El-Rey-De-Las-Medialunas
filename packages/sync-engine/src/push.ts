import type { SyncResult, ApiClientInterface, DbClientInterface } from "./types";

const BATCH_SIZE = 50;

// Errores por-operación que NO se resuelven reintentando (RBAC, payload
// inválido, estado irreconciliable). El resto —transient, colisión de número
// de venta, entity_type temporalmente desconocido— se deja "pending" para que
// el próximo ciclo de sync lo reintente.
const PERMANENT_ERROR_CODES = new Set([
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "INVALID_NUMERIC",
  "ALREADY_CLOSED",
  "CONFLICT",
]);

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

    // stopAfterBatch: corta el ciclo cuando hay ops que quedan "pending" para
    // reintentar (transporte caído o fallo transient). Sin esto, getPending
    // devolvería las mismas ops en la siguiente iteración → loop infinito.
    let stopAfterBatch = false;

    try {
      const response = await apiClient.sync.push(operations, branchId);

      if (!response.success || !response.data) {
        // Fallo a nivel de request (poco frecuente: el backend responde 200
        // incluso con fallos por-op). Dejamos las ops "pending" para reintentar
        // en el próximo ciclo; NO las borramos ni las marcamos failed.
        for (const change of batch) {
          allResults.push({
            client_id: change.client_id,
            status: "error",
            error: "Push request failed",
          });
        }
        stopAfterBatch = true;
      } else {
        const errors = response.data.errors ?? [];
        const failedById = new Map(errors.map((e) => [e.client_id, e] as const));

        const syncedIds: string[] = [];
        let hasRetryable = false;

        for (const change of batch) {
          const failure = failedById.get(change.client_id);
          if (!failure) {
            allResults.push({ client_id: change.client_id, status: "synced" });
            syncedIds.push(change.client_id);
            continue;
          }

          allResults.push({
            client_id: change.client_id,
            status: "error",
            error: failure.message,
          });

          if (PERMANENT_ERROR_CODES.has(failure.code)) {
            await db.syncQueue.markFailed(change.client_id, failure.message, 0);
          } else {
            // Transient: dejamos "pending" para reintentar en el próximo ciclo.
            hasRetryable = true;
          }
        }

        if (syncedIds.length > 0) {
          await db.syncQueue.remove(syncedIds);
        }

        if (hasRetryable) {
          stopAfterBatch = true;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      for (const change of batch) {
        allResults.push({
          client_id: change.client_id,
          status: "error",
          error: errorMessage,
        });
      }
      // Transporte caído: dejamos "pending" y cortamos. El próximo ciclo (30s)
      // o el evento "online" reintenta. No marcamos failed para no huérfanar
      // operaciones por un blip de red.
      stopAfterBatch = true;
    }

    if (stopAfterBatch) {
      break;
    }
    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  return allResults;
}
