import { createApiClient } from "@medialunas/api-client";
import { signOut } from "firebase/auth";

import { auth } from "../config/firebase";

// API Worker URL — configurable per environment
export const API_URL = import.meta.env.VITE_API_URL || "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

let client: ReturnType<typeof createApiClient> | null = null;
let refreshInFlight: Promise<string | null> | null = null;

// Multi-branch transfers (fase 3): sucursal "activa" que el operador está usando
// ahora mismo. AppContext/useUsers la actualiza cuando cambia el usuario logueado
// o cuando un rol elevado (admin/owner/supervisor) usa el selector de sucursal.
// Vive como singleton de módulo (mismo patrón que `client`/`refreshInFlight`)
// porque fetchWithAuth no tiene acceso al React tree — es la forma más simple
// de que cualquier request saliente pueda leer el valor actual sin prop-drilling.
let activeBranchId: string | null = null;

/** Actualiza la sucursal activa que se manda en el header X-Branch-Id de cada request. */
export function setActiveBranchId(branchId: string | null): void {
  activeBranchId = branchId;
}

/** Sucursal activa actual (o null si todavía no se resolvió desde el login). */
export function getActiveBranchId(): string | null {
  return activeBranchId;
}

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
      if (res.status === 401 || res.status === 403) handleLogout();
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

// Decodes the `sub` claim (internal user id, hex-32) from a JWT payload without
// verifying the signature. El backend firma el token con sub = user.id interno
// (NO el firebase uid), y ese mismo id es el que guarda requests.created_by_user_id.
// Por eso para saber "qué solicitudes creé yo" hay que comparar contra este valor,
// no contra activeUser.id (que es el firebase uid).
export function getAccessTokenUserId(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Id interno del usuario logueado (sub del access token). Null si no hay sesión. */
export function getCurrentUserId(): string | null {
  return getAccessTokenUserId(sessionStorage.getItem("access_token"));
}

export async function fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
  const buildHeaders = (token: string | null): HeadersInit => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // X-Branch-Id: le dice al backend qué sucursal está operando este request.
    // Para roles operativos el backend igual fuerza su default_branch del token
    // (el header es más relevante para admin/owner/supervisor con selector),
    // pero lo mandamos siempre que lo tengamos resuelto.
    if (activeBranchId) headers.set("X-Branch-Id", activeBranchId);
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
        // doTokenRefresh ya desloguea en los casos de falla real (401/403,
        // sin refresh_token, tokens malformados); un null aquí por 5xx/red
        // transitorio NO debe forzar logout de nuevo — solo se propaga el 401.
        const newToken = await refreshAccessToken();
        return !!newToken;
      },
    });
  }
  return client;
}
