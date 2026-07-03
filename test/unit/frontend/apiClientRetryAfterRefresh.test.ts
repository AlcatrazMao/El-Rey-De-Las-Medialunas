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
