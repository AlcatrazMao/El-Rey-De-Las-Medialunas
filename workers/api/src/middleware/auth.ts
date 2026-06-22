import type { Role } from "@medialunas/shared";
import { createMiddleware } from "hono/factory";

import type { Env, Variables } from "../types/bindings";
import { verifyJWT } from "../utils/jwt";

// BUG FIX M2 — antes el match era `path === route || path.startsWith(route + '/')`,
// lo que hacía que cualquier sub-path de una ruta pública también fuera público
// (por ejemplo `/api/v1/health/db-dump` bypasseaba auth si existiera). Las
// rutas que necesitamos públicas son SOLO estos paths exactos; no hay sub-paths
// legítimos. Las separamos en exactas vs prefijos por si algún día agregamos
// una pública que sí requiera prefix-match.
const PUBLIC_ROUTES_EXACT: ReadonlySet<string> = new Set([
  "/api/v1/health",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
]);

// Lista vacía por ahora. Agregar acá rutas que LEGÍTIMAMENTE requieran que
// todos sus sub-paths sean públicos (ej. estáticos servidos por el worker).
const PUBLIC_ROUTES_PREFIX: readonly string[] = [];

interface DecodedToken {
  uid: string;
  email?: string;
  role?: Role;
}

export function authMiddleware() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const path = new URL(c.req.url).pathname;

    if (
      PUBLIC_ROUTES_EXACT.has(path) ||
      PUBLIC_ROUTES_PREFIX.some((route) => path.startsWith(route + "/"))
    ) {
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

    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" },
        },
        401,
      );
    }

    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email : "";

    if (!sub) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" },
        },
        401,
      );
    }

    // SECURITY: rechazar tokens sin role o con role inválido. Antes se hacía
    // fallback silencioso a "cashier", lo que permitía a tokens malformados
    // (o forjados sin el claim) operar como cajero. Ahora exigimos que el
    // claim exista y coincida con el enum oficial de roles.
    const VALID_ROLES: Role[] = [
      "owner",
      "admin",
      "supervisor",
      "cashier",
      "production",
      "warehouse",
    ];
    const rawRole = typeof payload.role === "string" ? payload.role : null;
    if (!rawRole || !VALID_ROLES.includes(rawRole as Role)) {
      return c.json(
        {
          success: false,
          error: { code: "INVALID_TOKEN", message: "Token sin rol válido" },
        },
        401,
      );
    }
    const role = rawRole as Role;

    const branchHeader = c.req.header("X-Branch-Id") ?? "";

    // SECURITY: validate X-Branch-Id membership. admin/owner can operate in any
    // branch; all other roles must belong to the requested branch via user_branches.
    // Empty branchHeader skips the check (routes that don't need branch context).
    if (branchHeader && role !== "admin" && role !== "owner") {
      const rows = await c.env.DB
        .prepare("SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ? LIMIT 1")
        .bind(sub, branchHeader)
        .all<{ 1: number }>();
      if (!assertUserInBranch(sub, branchHeader, rows.results ?? [])) {
        return c.json(
          {
            success: false,
            error: { code: "BRANCH_ACCESS_DENIED", message: "No tenés acceso a esta sucursal" },
          },
          403,
        );
      }
    }

    c.set("userId", sub);
    c.set("userRole", role);
    c.set("branchId", branchHeader);
    c.set("firebaseUid", "");
    c.set("userEmail", email);
    c.set("requestId", crypto.randomUUID());

    await next();
  });
}

// Pure helper — testeable sin DB. Recibe los rows del SELECT sobre user_branches
// y retorna true si hay al menos un registro (membresía confirmada).
export function assertUserInBranch(
  _userId: string,
  _branchId: string,
  rows: unknown[],
): boolean {
  return rows.length > 0;
}

export async function verifyFirebaseToken(token: string, env: Env): Promise<DecodedToken> {
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
    const cacheKey = `tkn:${firebaseUid}:${payload.iat ?? 0}`;
    try {
      const cached = await env.CACHE.get(cacheKey, "json") as DecodedToken | null;
      if (cached) return cached;
    } catch (err) {
      console.warn('[auth-middleware] cache read failed for firebase token:', err);
    }

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      },
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
        } catch (err) {
          console.warn('[auth-middleware] cache write failed for firebase token:', err);
        }
      }
    }

    return decoded;
  }

  return { uid: firebaseUid, email: payload.email };
}
