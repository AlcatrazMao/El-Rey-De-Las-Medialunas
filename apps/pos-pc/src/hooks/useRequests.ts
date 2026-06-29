import { useState, useEffect, useCallback, useRef } from 'react';

import { requestsStore } from '../lib/idb';
import { API_URL, fetchWithAuth } from '../services/api';
import type { ERPRequest } from '../types';

const VERSION_KEY = 'erp_requests_version';

interface RequestsListResponse {
  success: boolean;
  data: ERPRequest[];
}

interface RequestsVersionResponse {
  success: boolean;
  data: { version: number };
}

/**
 * Hook para gestionar el ciclo de vida de solicitudes con cache local + versionado.
 *
 * Estrategia:
 *  1. Al montar, lee `localStorage` para obtener la versión cacheada.
 *  2. Llama `GET /api/v2/requests/version` para conocer la versión remota.
 *  3. Si la versión cambió → refetch completo (IDB + localStorage actualizados).
 *  4. Si coincide → reutiliza el cache de IDB (sin bajar todo).
 *  5. Polling automático cada 60s con check de versión.
 *
 * Sin red: se cae al cache de IDB y se expone `error` para que la UI lo informe.
 */
function readInitialVersion(): number {
  try {
    return Number(localStorage.getItem(VERSION_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

export function useRequests() {
  const [requests, setRequests] = useState<ERPRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // useRef en lugar de useState porque solo lo consume el callback de sync;
  // no necesitamos disparar re-render cuando cambia.
  const lastVersionRef = useRef<number>(readInitialVersion());
  // Guard para evitar que checkAndSync e invalidate corran fetchAll en paralelo.
  const inFlightRef = useRef(false);

  const fetchAll = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests?limit=200`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const data = (await res.json()) as RequestsListResponse;
      if (data.success && Array.isArray(data.data)) {
        // Reemplazo total: limpiamos el cache primero para que las solicitudes
        // borradas en backend no queden zombie en el cliente.
        await requestsStore.clear();
        await requestsStore.putMany(data.data);
        setRequests(data.data);
        setError(null);
        return true;
      }
      return false;
    } catch {
      // Fallback a IDB; mantiene la última copia local que tengamos.
      const cached = await requestsStore.getAll();
      setRequests(cached);
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const checkAndSync = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v2/requests/version`);
      if (!res.ok) throw new Error(`version fetch failed: ${res.status}`);
      const body = (await res.json()) as RequestsVersionResponse;
      const remoteVersion = body?.data?.version ?? 0;

      if (remoteVersion !== lastVersionRef.current) {
        const ok = await fetchAll();
        if (ok) {
          lastVersionRef.current = remoteVersion;
          try { localStorage.setItem(VERSION_KEY, String(remoteVersion)); } catch { /* quota */ }
        }
      } else {
        // Versión coincide → leer cache local.
        const cached = await requestsStore.getAll();
        setRequests(cached);
        setError(null);
      }
    } catch {
      // Sin red: usar IDB y mostrar aviso.
      const cached = await requestsStore.getAll();
      setRequests(cached);
      setError('Sin conexión — mostrando datos locales');
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    void checkAndSync();
    const id = setInterval(() => { void checkAndSync(); }, 60_000);
    return () => clearInterval(id);
  }, [checkAndSync]);

  /** Fuerza invalidación del cache y refetch inmediato (post-acción). */
  const invalidate = useCallback(async () => {
    try { localStorage.setItem(VERSION_KEY, '0'); } catch { /* quota */ }
    lastVersionRef.current = 0;
    await fetchAll();
  }, [fetchAll]);

  return {
    requests,
    loading,
    error,
    invalidate,
    refetch: checkAndSync,
  };
}
