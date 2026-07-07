import { describe, it, expect, vi, afterEach } from 'vitest';

import { ApiClient } from '../../../packages/api-client/src/client';
import { ApiError } from '../../../packages/api-client/src/types';

// ---------------------------------------------------------------------------
// Bug fixed here: ApiClient.request()/upload() used to call onUnauthorized()
// from inside handleResponse() and then immediately throw the 401 ApiError
// regardless of whether the token refresh succeeded — so every authenticated
// request (including apps/pos-pc's sales.create via getApi()) failed hard on
// an expired access token even though a fresh token was already saved to
// sessionStorage by the time the error propagated.
//
// Unlike other frontend tests in this suite, ApiClient has no import.meta.env
// / Firebase / browser-only dependencies, so it's imported directly here
// instead of being reimplemented locally — this exercises the real fix.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make401(): Response {
  return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Token de acceso requerido' } }, 401);
}

describe('ApiClient — retry after onUnauthorized refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('401 → onUnauthorized() returns true → retries once and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'sale-1' } }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale-token',
      onUnauthorized,
      retries: 0,
    });

    const result = await client.request('POST', '/api/v1/sales', { total: 100 });

    expect(result).toEqual({ data: { id: 'sale-1' } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('401 → onUnauthorized() returns false → propagates the original ApiError, no retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(make401());
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue(false);
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale-token',
      onUnauthorized,
      retries: 0,
    });

    await expect(client.request('POST', '/api/v1/sales', { total: 100 })).rejects.toThrow(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 on retry too → does not loop infinitely, propagates the second ApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(make401()).mockResolvedValueOnce(make401());
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale-token',
      onUnauthorized,
      retries: 0,
    });

    await expect(client.request('GET', '/api/v1/sales')).rejects.toThrow(ApiError);

    // Called once by request() — never recurses into a second refresh attempt.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('2+ concurrent requests hitting 401 share ONE real refresh (dedup mutex) and both retry with the fresh token', async () => {
    // Reproduces the "double-401" race: right after a sale, several D1-sync
    // requests fire almost simultaneously with the same (expired) access token.
    // Each request independently invokes onUnauthorized(); the module-level
    // refreshInFlight mutex in apps/pos-pc/src/services/api.ts must collapse
    // those into a SINGLE network refresh so the rotating refresh_token is not
    // spent twice (the second use would find it revoked → broken session).
    let currentToken = 'stale-token';

    // The fetch mock decides 401 vs 200 by the token actually sent — so a retry
    // only succeeds once the shared refresh has swapped the token to 'fresh'.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('Authorization');
      return auth === 'Bearer fresh-token' ? jsonResponse({ data: { ok: true } }, 200) : make401();
    });
    vi.stubGlobal('fetch', fetchMock);

    // Real refresh network call — must run exactly once despite N callers.
    const doRefresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5)); // in-flight window
      currentToken = 'fresh-token';
      return true;
    });

    // Mirror of api.ts refreshInFlight singleton-promise dedup.
    let refreshInFlight: Promise<boolean> | null = null;
    const onUnauthorized = vi.fn(async () => {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
      return refreshInFlight;
    });

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      getToken: () => currentToken,
      onUnauthorized,
      retries: 0,
    });

    const [a, b] = await Promise.all([
      client.request('POST', '/api/v1/sales', { total: 100 }),
      client.request('POST', '/api/v1/sync/push', { total: 200 }),
    ]);

    expect(a).toEqual({ data: { ok: true } });
    expect(b).toEqual({ data: { ok: true } });
    // Each request asks for a refresh, but only ONE real refresh network call runs.
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
    expect(doRefresh).toHaveBeenCalledTimes(1);
    // 2 initial 401s + 2 successful retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('upload() applies the same retry-after-refresh behaviour on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(jsonResponse({ data: { imported: 5 } }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale-token',
      onUnauthorized,
      retries: 0,
    });

    const formData = new FormData();
    formData.append('file', new Blob(['a,b,c']), 'products.csv');

    const result = await client.upload('/api/v1/products/import', formData);

    expect(result).toEqual({ data: { imported: 5 } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
