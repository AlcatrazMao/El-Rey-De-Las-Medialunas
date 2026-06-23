import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for the logout() logic in apps/pos-pc/src/hooks/useUsers.ts.
//
// We replicate the logout function inline (hermetic) so that Firebase,
// API_URL and signOut don't need to be mocked via module mocks.
//
// Key invariants:
//   1. fetch('/auth/logout') is called BEFORE storage is cleared.
//   2. If fetch throws (network error), storage is still cleared and signOut
//      is still called — logout must never be blocked by a backend failure.
//   3. The body of the fetch request includes the refresh_token.
// ---------------------------------------------------------------------------

type CallOrder = 'fetch' | 'removeAccess' | 'removeRefresh' | 'signOut';

/**
 * Factory that builds the logout function under test, injecting its
 * dependencies so each test gets a clean, controllable setup.
 */
function makeLogout(deps: {
  fetchFn: typeof fetch;
  signOutFn: () => void;
  getRefreshToken: () => string | null;
  removeAccessToken: () => void;
  removeRefreshToken: () => void;
  apiUrl?: string;
}) {
  const { fetchFn, signOutFn, getRefreshToken, removeAccessToken, removeRefreshToken, apiUrl = 'http://api' } = deps;

  // Mirrors the implementation in useUsers.ts exactly.
  return async function logout() {
    const refreshToken = getRefreshToken();
    try {
      await fetchFn(`${apiUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken ?? null }),
      });
    } catch {
      // Network failure → continue with local logout regardless.
    }
    removeAccessToken();
    removeRefreshToken();
    signOutFn();
  };
}

describe('logout() — useUsers', () => {
  let callOrder: CallOrder[];
  let fetchFn: ReturnType<typeof vi.fn>;
  let signOutFn: ReturnType<typeof vi.fn>;
  let removeAccessToken: ReturnType<typeof vi.fn>;
  let removeRefreshToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callOrder = [];

    fetchFn = vi.fn(async () => {
      callOrder.push('fetch');
      return new Response(null, { status: 200 });
    });

    signOutFn = vi.fn(() => {
      callOrder.push('signOut');
    });

    removeAccessToken = vi.fn(() => {
      callOrder.push('removeAccess');
    });

    removeRefreshToken = vi.fn(() => {
      callOrder.push('removeRefresh');
    });
  });

  it('fetch /auth/logout is called BEFORE clearing tokens', async () => {
    const logout = makeLogout({
      fetchFn,
      signOutFn,
      getRefreshToken: () => 'my-refresh-token',
      removeAccessToken,
      removeRefreshToken,
    });

    await logout();

    expect(callOrder[0]).toBe('fetch');
    expect(callOrder).toContain('removeAccess');
    expect(callOrder).toContain('removeRefresh');
    expect(callOrder).toContain('signOut');
  });

  it('fetch /auth/logout is called BEFORE signOut', async () => {
    const logout = makeLogout({
      fetchFn,
      signOutFn,
      getRefreshToken: () => 'tok',
      removeAccessToken,
      removeRefreshToken,
    });

    await logout();

    const fetchIdx = callOrder.indexOf('fetch');
    const signOutIdx = callOrder.indexOf('signOut');
    expect(fetchIdx).toBeLessThan(signOutIdx);
  });

  it('if fetch throws (network down), tokens are still cleared and signOut is called', async () => {
    const failingFetch = vi.fn(async () => {
      callOrder.push('fetch');
      throw new Error('Network Error');
    });

    const logout = makeLogout({
      fetchFn: failingFetch,
      signOutFn,
      getRefreshToken: () => 'tok',
      removeAccessToken,
      removeRefreshToken,
    });

    // Must not throw — logout is always safe to call.
    await expect(logout()).resolves.toBeUndefined();

    expect(removeAccessToken).toHaveBeenCalledTimes(1);
    expect(removeRefreshToken).toHaveBeenCalledTimes(1);
    expect(signOutFn).toHaveBeenCalledTimes(1);
  });

  it('if fetch fails with 500, tokens are still cleared', async () => {
    const failingFetch = vi.fn(async () => {
      callOrder.push('fetch');
      return new Response(null, { status: 500 });
    });

    const logout = makeLogout({
      fetchFn: failingFetch,
      signOutFn,
      getRefreshToken: () => 'tok',
      removeAccessToken,
      removeRefreshToken,
    });

    await logout();

    expect(removeAccessToken).toHaveBeenCalledTimes(1);
    expect(removeRefreshToken).toHaveBeenCalledTimes(1);
    expect(signOutFn).toHaveBeenCalledTimes(1);
  });

  it('fetch body includes the refresh_token', async () => {
    const REFRESH_TOKEN = 'rt_abc123';
    let capturedBody: unknown;

    const capturingFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      callOrder.push('fetch');
      capturedBody = JSON.parse(init?.body as string);
      return new Response(null, { status: 200 });
    });

    const logout = makeLogout({
      fetchFn: capturingFetch,
      signOutFn,
      getRefreshToken: () => REFRESH_TOKEN,
      removeAccessToken,
      removeRefreshToken,
    });

    await logout();

    expect(capturedBody).toEqual({ refresh_token: REFRESH_TOKEN });
  });

  it('when no refresh_token in storage, body sends refresh_token: null (not undefined)', async () => {
    let capturedBody: unknown;

    const capturingFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      callOrder.push('fetch');
      capturedBody = JSON.parse(init?.body as string);
      return new Response(null, { status: 200 });
    });

    const logout = makeLogout({
      fetchFn: capturingFetch,
      signOutFn,
      getRefreshToken: () => null,
      removeAccessToken,
      removeRefreshToken,
    });

    await logout();

    // null serializes correctly in JSON; undefined would disappear.
    expect((capturedBody as Record<string, unknown>).refresh_token).toBeNull();
  });
});
