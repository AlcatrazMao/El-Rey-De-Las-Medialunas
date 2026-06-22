import { createApiClient } from "@medialunas/api-client";
import { signOut } from "firebase/auth";

import { auth } from "../config/firebase";

// API Worker URL — configurable per environment
export const API_URL = import.meta.env.VITE_API_URL || "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

let client: ReturnType<typeof createApiClient> | null = null;
let refreshInFlight: Promise<boolean> | null = null;

function handleLogout(): void {
  sessionStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  signOut(auth).catch(() => {});
}

// Exported for testing: the actual network call that exchanges the refresh token
// for new tokens. Isolated so tests can mock it without touching the singleton logic.
export async function doTokenRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    handleLogout();
    return false;
  }
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      handleLogout();
      return false;
    }
    const data = await res.json();
    const tokens = data?.data?.tokens;
    if (!tokens?.access_token || !tokens?.refresh_token) {
      handleLogout();
      return false;
    }
    sessionStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// Singleton-promise refresh: if a refresh is already in flight, all concurrent
// callers await the same promise instead of triggering multiple network requests.
export async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doTokenRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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
    const ok = await refreshAccessToken();
    if (!ok) return response;
    const newToken = sessionStorage.getItem("access_token");
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
        const ok = await refreshAccessToken();
        if (!ok) handleLogout();
      },
    });
  }
  return client;
}
