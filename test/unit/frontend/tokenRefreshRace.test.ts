import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the singleton-promise logic from
// apps/pos-pc/src/services/api.ts — kept local so the test is hermetic
// (no Firebase / import.meta.env / fetch calls to the real API).
// ---------------------------------------------------------------------------

/**
 * The function under test: wraps an async "do the real refresh" call behind a
 * singleton promise so that N concurrent callers share a single in-flight
 * request instead of triggering N separate ones.
 */
function makeRefreshMechanism(doActualRefresh: () => Promise<boolean>) {
  let refreshInFlight: Promise<boolean> | null = null;

  return async function refreshAccessToken(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = doActualRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('refreshAccessToken — singleton promise (race condition fix)', () => {
  let doActualRefresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Each test gets a fresh mock that resolves with true (successful refresh).
    doActualRefresh = vi.fn((): Promise<boolean> => Promise.resolve(true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('llama doActualRefresh exactamente 1 vez cuando N callers concurrentes detectan 401', async () => {
    const refreshAccessToken = makeRefreshMechanism(doActualRefresh);
    const N = 5;

    // Simula N requests concurrentes que detectan 401 al mismo tiempo.
    const results = await Promise.all(
      Array.from({ length: N }, () => refreshAccessToken()),
    );

    // Todos deben recibir true (el token fue renovado).
    expect(results).toHaveLength(N);
    results.forEach(r => expect(r).toBe(true));

    // El refresh de red debe haberse ejecutado UNA sola vez.
    expect(doActualRefresh).toHaveBeenCalledTimes(1);
  });

  it('después de que el promise se resuelve, una llamada posterior inicia un refresh nuevo', async () => {
    const refreshAccessToken = makeRefreshMechanism(doActualRefresh);

    // Primera ola — se resuelve
    await refreshAccessToken();
    expect(doActualRefresh).toHaveBeenCalledTimes(1);

    // Segunda ola — debe iniciar un refresh nuevo porque refreshInFlight ya es null
    await refreshAccessToken();
    expect(doActualRefresh).toHaveBeenCalledTimes(2);
  });

  it('si doActualRefresh falla, todos los callers concurrentes reciben false', async () => {
    const failingRefresh = vi.fn((): Promise<boolean> => Promise.resolve(false));
    const refreshAccessToken = makeRefreshMechanism(failingRefresh);

    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    results.forEach(r => expect(r).toBe(false));
    expect(failingRefresh).toHaveBeenCalledTimes(1);
  });

  it('si doActualRefresh lanza, todos los callers reciben el mismo rechazo', async () => {
    const boom = new Error('network failure');
    const throwingRefresh = vi.fn((): Promise<boolean> => Promise.reject(boom));

    // Wrapeamos finally para que refreshInFlight se limpie igual si lanza.
    let refreshInFlight: Promise<boolean> | null = null;
    const refreshAccessToken = async (): Promise<boolean> => {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = throwingRefresh().finally(() => {
        refreshInFlight = null;
      });
      return refreshInFlight;
    };

    const promises = [
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ];

    const settled = await Promise.allSettled(promises);
    settled.forEach(r => {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBe(boom);
    });
    expect(throwingRefresh).toHaveBeenCalledTimes(1);
  });

  it('llamadas secuenciales (no concurrentes) no comparten el promise singleton', async () => {
    const refreshAccessToken = makeRefreshMechanism(doActualRefresh);

    // Esperar cada llamada antes de la siguiente → no son concurrentes.
    await refreshAccessToken();
    await refreshAccessToken();
    await refreshAccessToken();

    expect(doActualRefresh).toHaveBeenCalledTimes(3);
  });
});
