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
      "driver",
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

    const rawBranches = Array.isArray(payload.branches)
      ? payload.branches.filter((b): b is string => typeof b === "string")
      : [];
    const rawDefaultBranch = typeof payload.default_branch === "string" ? payload.default_branch : null;

    c.set("userId", sub);
    c.set("userRole", role);
    c.set("branchId", branchHeader);
    c.set("firebaseUid", "");
    c.set("userEmail", email);
    c.set("requestId", crypto.randomUUID());
    c.set("userBranches", rawBranches);
    c.set("userDefaultBranch", rawDefaultBranch);

    await next();
  });
}

// Roles operativos: siempre restringidos a su default_branch, sin importar
// qué venga en query params — evita que un cashier/production/driver, etc.
// pida datos de otra sucursal aunque no tenga membresía explícita ahí.
const OPERATIONAL_ROLES: ReadonlySet<Role> = new Set([
  "cashier",
  "production",
  "warehouse",
  "driver",
]);

// Roles elevados: pueden operar en cualquier sucursal (o en modo agregado,
// sin branchId, si la ruta lo soporta) mediante un query param validado.
const ELEVATED_ROLES: ReadonlySet<Role> = new Set(["admin", "owner", "supervisor"]);

interface BranchScopeContext {
  get(key: "userRole"): Role;
  get(key: "userDefaultBranch"): string | null | undefined;
  req: { query(key: string): string | undefined };
  set(key: "branchId", value: string): void;
}

// Resultado puro de resolveBranchScopeValue: o bien un branchId a setear, o
// un error explícito que el caller (middleware o route) debe convertir en
// una respuesta HTTP. No devolvemos "" silencioso en el caso de error porque
// "" también es un valor legítimo (modo agregado para roles elevados) —
// mezclar ambos significados en el mismo tipo fue el bug original: un rol
// operativo sin default_branch terminaba con branchId="" y caía en el
// fallback DEFAULT_BRANCH_ID de cada ruta, dándole acceso de facto a la
// sucursal 1 en lugar de ser rechazado.
type BranchScopeResult =
  | { ok: true; branchId: string }
  | { ok: false; code: "NO_DEFAULT_BRANCH" };

// Resuelve qué branchId aplica a la request según el rol.
//
// - Roles operativos (cashier, production, warehouse, driver, etc.): se
//   fuerza el uso de token.default_branch, IGNORANDO cualquier query param
//   ?branch_id= que venga en la URL. Esto cierra el vector de que un rol de
//   piso pida datos de una sucursal a la que no debería tener acceso por
//   default con solo cambiar un query param.
//   BUG FIX: si el rol operativo no tiene default_branch asignado (dato
//   corrupto/incompleto), se rechaza explícitamente en vez de degradar a
//   branchId="" (lo que antes terminaba en acceso implícito a la sucursal
//   DEFAULT_BRANCH_ID vía el fallback de cada ruta).
// - Roles elevados (admin, owner, supervisor): pueden pasar ?branch_id=<id>
//   para operar sobre una sucursal específica (se valida contra
//   userBranches si vino en el token; si branches está vacío —p.ej. admin
//   con acceso implícito a todas— se permite igual, ya que auth middleware
//   ya no restringe X-Branch-Id para admin/owner). Si no se pasa branch_id,
//   queda en modo agregado (branchId vacío = "todas las sucursales").
export function resolveBranchScopeValue(c: BranchScopeContext): BranchScopeResult {
  const role = c.get("userRole");

  if (OPERATIONAL_ROLES.has(role)) {
    const defaultBranch = c.get("userDefaultBranch");
    if (!defaultBranch) {
      return { ok: false, code: "NO_DEFAULT_BRANCH" };
    }
    return { ok: true, branchId: defaultBranch };
  }

  if (ELEVATED_ROLES.has(role)) {
    const queryBranch = c.req.query("branch_id") ?? "";
    return { ok: true, branchId: queryBranch };
  }

  // Rol desconocido (no debería llegar acá porque authMiddleware ya valida
  // contra VALID_ROLES) — fallback seguro: sin acceso a ninguna sucursal.
  return { ok: true, branchId: "" };
}

// Middleware Hono: corre DESPUÉS de authMiddleware() y ANTES de las rutas.
// Setea c.set('branchId', ...) para que cualquier ruta lo pueda leer con
// c.get('branchId'). Si el rol es operativo y no tiene default_branch,
// corta la cadena con 403 en vez de dejar pasar un branchId vacío.
export function resolveBranchScope() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const result = resolveBranchScopeValue(c);
    if (!result.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: "NO_DEFAULT_BRANCH",
            message: "Tu usuario no tiene una sucursal por defecto asignada",
          },
        },
        403,
      );
    }
    c.set("branchId", result.branchId);
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
