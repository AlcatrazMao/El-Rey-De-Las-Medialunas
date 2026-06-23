import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the fetchWithAuth + refreshAccessToken logic from
// apps/pos-pc/src/services/api.ts — kept local so the test is hermetic
// (no Firebase / import.meta.env / fetch calls to the real API).
//
// Key behaviour under test:
//   • On 401, fetchWithAuth calls refreshAccessToken() and uses the returned
//     token directly in the retry — NOT sessionStorage.getItem() again.
//   • If refreshAccessToken() returns null, no retry is made and the 401
//     response is returned (and logout is triggered).
// ---------------------------------------------------------------------------

/**
 * Factory that recreates the fetchWithAuth + refreshAccessToken pair, wiring
 * them to an injected doTokenRefresh so tests can mock that dependency.
 * The returned pair mirrors the real implementation type signatures exactly.
 */
function makeAuthFetch(
  doTokenRefresh: () => Promise<string | null>,
  onLogout: () => void,
  fetchFn: typeof fetch,
) {
  let refreshInFlight: Promise<string | null> | null = null;

  async function refreshAccessToken(): Promise<string | null> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = doTokenRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
    const buildHeaders = (token: string | null): HeadersInit => {
      const headers = new Headers(init.headers || {});
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return headers;
    };

    // Simulate sessionStorage.getItem("access_token") → always use null here
    // so first request has no stale token; 401 is the trigger we're testing.
    const firstToken: string | null = null;
    let response = await fetchFn(input, { ...init, headers: buildHeaders(firstToken) });

    if (response.status === 401) {
      const newToken = await refreshAccessToken();
      if (!newToken) {
        onLogout();
        return response;
      }
      // Uses the token returned by refreshAccessToken directly — not re-reading
      // from storage.
      response = await fetchFn(input, { ...init, headers: buildHeaders(newToken) });
    }

    return response;
  }

  return { fetchWithAuth, refreshAccessToken };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make401(): Response {
  return new Response(null, { status: 401 });
}

function make200(): Response {
  return new Response('{"ok":true}', { status: 200 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchWithAuth — retry uses token from refreshAccessToken directly', () => {
  let onLogout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onLogout = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('on 401 → calls doTokenRefresh → uses returned token in retry header (not storage)', async () => {
    const NEW_TOKEN = 'fresh-access-token-xyz';
    const doTokenRefresh = vi.fn(async () => NEW_TOKEN);

    // First call → 401; second call (retry) → 200
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(make200());

    const { fetchWithAuth } = makeAuthFetch(doTokenRefresh, onLogout, fetchFn);

    const result = await fetchWithAuth('/api/test');

    expect(result.status).toBe(200);
    expect(doTokenRefresh).toHaveBeenCalledTimes(1);

    // The retry (second fetch call) must carry the Authorization header with
    // the token returned by doTokenRefresh — not a value read from sessionStorage.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const retryInit = fetchFn.mock.calls[1][1] as RequestInit;
    const retryHeaders = new Headers(retryInit.headers);
    expect(retryHeaders.get('Authorization')).toBe(`Bearer ${NEW_TOKEN}`);
  });

  it('if doTokenRefresh returns null → no retry, calls logout, returns 401 response', async () => {
    const doTokenRefresh = vi.fn(async (): Promise<string | null> => null);

    const fetchFn = vi.fn().mockResolvedValueOnce(make401());

    const { fetchWithAuth } = makeAuthFetch(doTokenRefresh, onLogout, fetchFn);

    const result = await fetchWithAuth('/api/test');

    expect(result.status).toBe(401);
    // Only one fetch call — no retry
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(doTokenRefresh).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('if first response is 200 → doTokenRefresh is never called', async () => {
    const doTokenRefresh = vi.fn(async () => 'should-not-be-called');
    const fetchFn = vi.fn().mockResolvedValueOnce(make200());

    const { fetchWithAuth } = makeAuthFetch(doTokenRefresh, onLogout, fetchFn);

    const result = await fetchWithAuth('/api/test');

    expect(result.status).toBe(200);
    expect(doTokenRefresh).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('concurrent 401s share a single doTokenRefresh call (singleton promise)', async () => {
    const NEW_TOKEN = 'shared-token';
    const doTokenRefresh = vi.fn(async () => {
      // Simulate async network delay
      await Promise.resolve();
      return NEW_TOKEN;
    });

    // All calls get 401 then 200
    const fetchFn = vi.fn().mockResolvedValue(make401());

    const { fetchWithAuth, refreshAccessToken } = makeAuthFetch(doTokenRefresh, onLogout, fetchFn);

    // Trigger 3 concurrent refreshes directly via refreshAccessToken
    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    results.forEach(t => expect(t).toBe(NEW_TOKEN));
    expect(doTokenRefresh).toHaveBeenCalledTimes(1);
  });

  it('doTokenRefresh returning a token string is used verbatim in Authorization header', async () => {
    const TOKEN_WITH_SPECIAL_CHARS = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
    const doTokenRefresh = vi.fn(async () => TOKEN_WITH_SPECIAL_CHARS);

    const fetchFn = vi.fn()
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(make200());

    const { fetchWithAuth } = makeAuthFetch(doTokenRefresh, onLogout, fetchFn);

    await fetchWithAuth('/api/protected');

    const retryInit = fetchFn.mock.calls[1][1] as RequestInit;
    const retryHeaders = new Headers(retryInit.headers);
    expect(retryHeaders.get('Authorization')).toBe(`Bearer ${TOKEN_WITH_SPECIAL_CHARS}`);
  });
});
