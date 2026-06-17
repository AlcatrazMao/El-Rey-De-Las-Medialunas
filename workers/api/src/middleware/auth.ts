import type { Role } from "@medialunas/shared";
import { createMiddleware } from "hono/factory";

import type { Env, Variables } from "../types/bindings";

const PUBLIC_ROUTES = [
  "/api/v1/health",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/validate",
];

interface DecodedToken {
  uid: string;
  email?: string;
  role?: Role;
}

export function authMiddleware() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const path = new URL(c.req.url).pathname;

    if (PUBLIC_ROUTES.some((route) => path.startsWith(route))) {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Token de acceso requerido" },
        },
        401,
      );
    }

    const token = authHeader.slice(7);

    let decoded: DecodedToken;
    try {
      decoded = await verifyFirebaseToken(token, c.env);
    } catch {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" },
        },
        401,
      );
    }

    const branchHeader = c.req.header("X-Branch-Id") ?? "";

    c.set("userId", decoded.uid);
    c.set("userRole", decoded.role ?? "cashier");
    c.set("branchId", branchHeader);
    c.set("firebaseUid", decoded.uid);
    c.set("userEmail", decoded.email ?? "");
    c.set("requestId", crypto.randomUUID());

    await next();
  });
}

async function verifyFirebaseToken(token: string, env: Env): Promise<DecodedToken> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const encodedPayload = parts[1];
  if (!encodedPayload) throw new Error("Invalid token");

  let payload: { user_id?: string; uid?: string; sub?: string; email?: string; exp?: number; iat?: number };
  try {
    payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    throw new Error("Invalid token payload");
  }

  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw new Error("Token expired");
  }

  const firebaseUid = payload.user_id ?? payload.uid ?? payload.sub;
  if (!firebaseUid) throw new Error("No uid in token");

  if (env.FIREBASE_API_KEY) {
    // KV cache: avoid repeated Firebase API calls for the same token
    const cacheKey = `tkn:${firebaseUid}:${payload.iat ?? 0}`;
    try {
      const cached = await env.CACHE.get(cacheKey, "json") as DecodedToken | null;
      if (cached) return cached;
    } catch { /* cache miss, continue */ }

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );

    if (!res.ok) throw new Error("Firebase token verification failed");

    const data = await res.json<{ users?: Array<{ localId: string; email?: string; disabled?: boolean }> }>();
    const fbUser = data.users?.[0];
    if (!fbUser?.localId) throw new Error("Token invalid: user not found");
    if (fbUser.disabled) throw new Error("User account disabled");

    const decoded: DecodedToken = { uid: fbUser.localId, email: fbUser.email };

    if (payload.exp) {
      const ttl = Math.min(Math.floor((payload.exp * 1000 - Date.now()) / 1000), 300);
      if (ttl > 0) {
        try {
          await env.CACHE.put(cacheKey, JSON.stringify(decoded), { expirationTtl: ttl });
        } catch { /* non-critical */ }
      }
    }

    return decoded;
  }

  // Dev fallback when FIREBASE_API_KEY not configured (token NOT verified)
  return { uid: firebaseUid, email: payload.email };
}
