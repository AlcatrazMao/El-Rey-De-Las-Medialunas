import { createApiClient } from "@medialunas/api-client";
import { signOut } from "firebase/auth";

import { auth } from "../config/firebase";

// API Worker URL — configurable per environment
export const API_URL = import.meta.env.VITE_API_URL || "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

let client: ReturnType<typeof createApiClient> | null = null;
let refreshInFlight: Promise<string | null> | null = null;

function handleLogout(): void {
  sessionStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  signOut(auth).catch(() => {});
}

// Exported for testing: the actual network call that exchanges the refresh token
// for new tokens. Returns the new access token on success, or null on failure.
// Isolated so tests can mock it without touching the singleton logic.
export async function doTokenRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    handleLogout();
    return null;
  }
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      handleLogout();
      return null;
    }
    const data = await res.json();
    const tokens = data?.data?.tokens;
    if (!tokens?.access_token || !tokens?.refresh_token) {
      handleLogout();
      return null;
    }
    sessionStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    return tokens.access_token as string;
  } catch {
    return null;
  }
}

// Singleton-promise refresh: if a refresh is already in flight, all concurrent
// callers await the same promise instead of triggering multiple network requests.
// Returns the new access token, or null if the refresh failed.
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doTokenRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// Decodes the `exp` claim (seconds since epoch) from a JWT's payload segment
// without verifying the signature — used only to decide whether it's worth
// proactively refreshing before a batch of requests. Returns null if the
// token is missing/malformed, which callers should treat as "can't tell,
// don't block on it".
export function getAccessTokenExpiry(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64url = parts[1];
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isAccessTokenExpired(): boolean {
  const token = sessionStorage.getItem("access_token");
  const exp = getAccessTokenExpiry(token);
  if (exp === null) return false;
  return exp * 1000 < Date.now();
}

export async function fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
  const buildHeaders = (token: string | null): HeadersInit => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  };

  const firstToken = sessionStorage.getItem("access_token");
  let response = await fetch(input, { ...init, headers: buildHeaders(firstToken) });

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) return response;
    response = await fetch(input, { ...init, headers: buildHeaders(newToken) });
  }

  return response;
}

export function getApi() {
  if (!client) {
    client = createApiClient({
      baseUrl: API_URL,
      getToken: () => sessionStorage.getItem("access_token") || "",
      onUnauthorized: async () => {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          handleLogout();
          return false;
        }
        return true;
      },
    });
  }
  return client;
}
