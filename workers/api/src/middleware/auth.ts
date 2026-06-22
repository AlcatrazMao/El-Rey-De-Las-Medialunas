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

    // TODO(SECURITY/HIGH): el header X-Branch-Id se acepta sin verificar que el
    // usuario pertenezca a esa sucursal. Hoy mitigamos el riesgo más serio en los
    // endpoints sensibles (ver sync.ts POST /push: chequea user_branches). Sin
    // embargo cualquier route que confíe en `c.get("branchId")` para resolver
    // ámbito (reports, dashboard, etc.) puede ser inducida a leer/escribir en
    // otra sucursal por un cajero malicioso simplemente cambiando el header.
    //
    // Fix correcto: query a user_branches en cada request — invasivo (un round-trip
    // a D1 por request) y requiere o caché por uid o moverlo al JWT (claim
    // `branches[]`) para evitar el costo. Se difiere a una migración de schema
    // dedicada que agregue ese claim al issue del token.
    c.set("userId", sub);
    c.set("userRole", role);
    c.set("branchId", branchHeader);
    c.set("firebaseUid", "");
    c.set("userEmail", email);
    c.set("requestId", crypto.randomUUID());

    await next();
  });
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
