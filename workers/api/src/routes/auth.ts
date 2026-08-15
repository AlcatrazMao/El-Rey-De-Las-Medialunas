import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { resolveUser } from "../lib/resolve-user";
import { signJWT } from "../utils/jwt";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_SECONDS = 28800;

// TTL de la blocklist de tokens revocados: cubre el tiempo de expiración del
// access token (15 min) más margen. Exportado para tests sin KV.
export function revokedTtlSeconds(): number {
  return 1800;
}

// Roles válidos del sistema. Debe coincidir con el CHECK de `users.role`
// (migrations/0022) y con VALID_ROLES en workers/api/src/middleware/auth.ts.
export const VALID_ROLES = [
  "owner",
  "admin",
  "supervisor",
  "cashier",
  "production",
  "warehouse",
  "driver",
] as const;

export function isValidRole(role: unknown): role is (typeof VALID_ROLES)[number] {
  return typeof role === "string" && (VALID_ROLES as readonly string[]).includes(role);
}

// Hashea el email en minúsculas con SHA-256 y retorna el hex digest.
// Exportada para tests unitarios.
export async function hashEmail(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.toLowerCase()),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  name: string;
  role: string;
  // En DB siempre es un JSON string. En caché puede llegar string (formato
  // canónico) o ya parseado a array (si alguna escritura previa lo serializó
  // así). Normalizamos en lectura con `parseCustomPanels`.
  custom_panels: string | string[] | null;
}

// Normaliza `custom_panels` a `string[] | null` sin importar si vino como
// string (formato DB) o ya como array (formato cacheado en versiones viejas).
export function parseCustomPanels(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

interface RefreshSession {
  userId: string;
  role: string;
  email: string;
  issuedAt: number;
  branches: string[];
  default_branch: string | null;
}

async function verifyFirebaseIdToken(idToken: string, env: Env): Promise<{ uid: string; email?: string; name?: string; role?: string } | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  const encodedPayload = parts[1];
  if (!encodedPayload) return null;

  let payload: { user_id?: string; uid?: string; sub?: string; email?: string; name?: string; role?: string; exp?: number };
  try {
    payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;

  const firebaseUid = payload.user_id ?? payload.uid ?? payload.sub;
  if (!firebaseUid) return null;

  const apiKey = env.FIREBASE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('FIREBASE_API_KEY not configured — cannot verify token');
  }

  let res: Response;
  try {
    res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
  } catch (err) {
    console.error('[auth] identitytoolkit fetch failed:', err);
    return null;
  }

  if (!res.ok) return null;

  const data = await res.json<{ users?: Array<{ localId: string; email?: string; disabled?: boolean }> }>();
  const fbUser = data.users?.[0];
  if (!fbUser?.localId || fbUser.disabled) return null;

  // `role` es un custom claim setado por admin-users vía `customAttributes`
  // (`{"role": "admin"}`) y viene firmado dentro del ID token verificado por
  // Google. `name` es el displayName estándar del token.
  return {
    uid: fbUser.localId,
    email: fbUser.email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
  };
}

async function issueTokens(
  env: Env,
  user: {
    id: string;
    email: string;
    role: string;
    branches: string[];
    default_branch: string | null;
  },
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: "Bearer" }> {
  const nowSec = Math.floor(Date.now() / 1000);
  // Contrato del payload JWT: {sub, role, email, branches, default_branch, iat, exp}
  const accessToken = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      branches: user.branches,
      default_branch: user.default_branch,
      iat: nowSec,
      exp: nowSec + ACCESS_TOKEN_TTL_SECONDS,
    },
    env.JWT_SECRET,
  );

  const refreshToken = crypto.randomUUID();
  const session: RefreshSession = {
    userId: user.id,
    role: user.role,
    email: user.email,
    issuedAt: nowSec,
    branches: user.branches,
    default_branch: user.default_branch,
  };

  await env.SESSIONS.put(`rt:${refreshToken}`, JSON.stringify(session), {
    expirationTtl: REFRESH_TOKEN_TTL_SECONDS,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    token_type: "Bearer",
  };
}

authRoutes.post("/login", async (c) => {
  try {
    const { idToken } = await c.req.json<{ idToken: string }>();
    if (!idToken) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "idToken requerido" } }, 400);

    const verified = await verifyFirebaseIdToken(idToken, c.env);
    if (!verified) {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" } }, 401);
    }

    const uid = verified.uid;

    let user: UserRow | null = null;
    try {
      const cached = await c.env.CACHE.get(`user:${uid}`, "json");
      if (
        cached &&
        typeof cached === "object" &&
        typeof (cached as Partial<UserRow>).id === "string" &&
        typeof (cached as Partial<UserRow>).firebase_uid === "string" &&
        typeof (cached as Partial<UserRow>).email === "string" &&
        typeof (cached as Partial<UserRow>).role === "string"
      ) {
        user = cached as UserRow;
        // SECURITY: verificar que el firebase_uid del caché coincide con el uid
        // del token verificado. Un caché corrupto o colisión de key podría
        // devolver el perfil de otro usuario. Tratar como miss y forzar re-fetch.
        if (user.firebase_uid !== uid) {
          console.warn('[auth] cached user firebase_uid mismatch — treating as cache miss');
          user = null;
        }
      } else if (cached) {
        console.warn('[auth] cached user payload failed shape validation, treating as cache miss');
      }
    } catch (err) {
      console.warn('[auth] cache read failed for user lookup:', err);
    }

    if (!user) {
      user = await c.env.DB.prepare(
        "SELECT id, firebase_uid, email, name, role, custom_panels FROM users WHERE firebase_uid = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(uid).first<UserRow>();

      if (!user) {
        // AUTO-PROVISIONING: el usuario está verificado en Firebase pero no
        // tiene fila en D1 (ej. creado desde la consola de Firebase o no
        // sincronizado por admin-users). Lo provisionamos acá para que pueda
        // operar sin pasos manuales de DB.
        //
        // SECURITY: el rol NO viene del body del cliente — sale del custom
        // claim `role` del ID token verificado por Google (el mismo claim que
        // admin-users escribe vía customAttributes). Si el claim falta o no es
        // uno de los roles válidos, rechazamos: NO defaultéamos a un rol (eso
        // abriría auto-registro de un atacante como usuario del POS).
        if (!isValidRole(verified.role)) {
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
        }

        const role = verified.role;
        const email = verified.email ?? "";
        const name = verified.name?.trim() || email || "Usuario";

        try {
          // id = firebase_uid = uid, igual que admin-users (id interno == uid
          // de Firebase), para mantener consistente el `sub` del JWT.
          await c.env.DB.prepare(
            "INSERT INTO users (id, firebase_uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(firebase_uid) DO NOTHING",
          ).bind(uid, uid, email, name, role).run();

          // Aseguramos membresía a una sucursal (default = primera activa),
          // igual que el backfill de migrations/0022. Sin esto, roles
          // operativos quedarían sin default_branch y no podrían operar.
          await c.env.DB.prepare(
            `INSERT INTO user_branches (user_id, branch_id, is_default)
             SELECT ?, (SELECT b.id FROM branches b WHERE b.deleted_at IS NULL ORDER BY b.created_at LIMIT 1), 1
             WHERE NOT EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = ?)`,
          ).bind(uid, uid).run();

          user = {
            id: uid,
            firebase_uid: uid,
            email,
            name,
            role,
            custom_panels: null,
          };
        } catch (err) {
          console.error('[auth] self-provisioning failed:', err);
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
        }
      }

      try {
        // Guardamos siempre el row con custom_panels como string (formato DB)
        // para mantener el caché en un único shape canónico.
        const cachedUser: UserRow = {
          ...user,
          custom_panels:
            typeof user.custom_panels === "string" || user.custom_panels === null
              ? user.custom_panels
              : JSON.stringify(user.custom_panels),
        };
        await c.env.CACHE.put(`user:${uid}`, JSON.stringify(cachedUser), { expirationTtl: 3600 });
      } catch (err) {
        console.warn('[auth] cache write failed for user:', err);
      }
    }

    try {
      const ip = c.req.header("CF-Connecting-IP") || "unknown";
      await c.env.DB.prepare(
        "INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, ip_address, created_at) VALUES (?, ?, 'auth.login', 'users', ?, ?, datetime('now'))",
      ).bind(crypto.randomUUID(), user.id, user.id, ip).run();
    } catch (err) {
      console.warn('[auth] audit_log insert failed on login:', err);
    }

    // Resolvemos branches[] / default_branch en el momento de emitir tokens
    // (no se cachea junto al user: user_branches puede cambiar sin que el
    // caché de perfil se invalide, así que siempre se lee fresco de DB).
    const resolved = await resolveUser(c.env.DB, user.id);
    const branchIds = resolved?.branches.map((b) => b.branch_id) ?? [];
    const defaultBranch = resolved?.default_branch ?? null;

    const tokens = await issueTokens(c.env, {
      id: user.id,
      email: user.email,
      role: user.role,
      branches: branchIds,
      default_branch: defaultBranch,
    });

    // `parseCustomPanels` acepta string (DB) o string[] (caché legacy) y
    // siempre devuelve string[] | null — elimina la inconsistencia.
    const customPanels = parseCustomPanels(user.custom_panels);

    return c.json({
      success: true,
      data: {
        tokens,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, custom_panels: customPanels },
      },
    });
  } catch (err: unknown) {
    console.error('[auth] login error:', err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, 500);
  }
});

authRoutes.post("/refresh", async (c) => {
  try {
    const { refresh_token } = await c.req.json<{ refresh_token: string }>();
    if (!refresh_token) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "refresh_token requerido" } }, 400);
    }

    const key = `rt:${refresh_token}`;

    // Check revocation blocklist first (defends against in-flight concurrent reuse)
    const revoked = await c.env.SESSIONS.get(`revoked:${refresh_token}`);
    if (revoked) {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Refresh token inválido o expirado" } }, 401);
    }

    const stored = await c.env.SESSIONS.get(key, "json") as RefreshSession | null;
    if (!stored) {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Refresh token inválido o expirado" } }, 401);
    }

    // Delete BEFORE issuing new tokens to minimize TOCTOU window
    await c.env.SESSIONS.delete(key);
    // Add to revocation blocklist with TTL = revokedTtlSeconds() (1800s).
    // Cubre el lifetime del access token (15 min) más margen, así un token
    // rotado no puede reutilizarse aunque el cliente tarde en recibir el nuevo.
    await c.env.SESSIONS.put(`revoked:${refresh_token}`, '1', { expirationTtl: revokedTtlSeconds() });

    // Now issue new tokens. Re-resolvemos branches/default_branch de DB (en
    // vez de confiar ciegamente en lo guardado en `stored`) para reflejar
    // cambios de asignación de sucursal que hayan ocurrido desde el login.
    const resolved = await resolveUser(c.env.DB, stored.userId);
    const branchIds = resolved?.branches.map((b) => b.branch_id) ?? stored.branches ?? [];
    const defaultBranch = resolved?.default_branch ?? stored.default_branch ?? null;

    const tokens = await issueTokens(c.env, {
      id: stored.userId,
      email: stored.email,
      role: stored.role,
      branches: branchIds,
      default_branch: defaultBranch,
    });

    return c.json({ success: true, data: { tokens } });
  } catch (err: unknown) {
    console.error('[auth] refresh error:', err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, 500);
  }
});

authRoutes.post("/logout", async (c) => {
  try {
    const { refresh_token } = await c.req.json<{ refresh_token: string }>();
    if (!refresh_token) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "refresh_token requerido" } }, 400);
    }

    const key = `rt:${refresh_token}`;
    const stored = await c.env.SESSIONS.get(key, "json") as RefreshSession | null;

    await c.env.SESSIONS.delete(key);

    if (stored) {
      // Marcar el token como revocado en la blocklist para cubrir in-flight requests.
      try {
        await c.env.SESSIONS.put(`revoked:${refresh_token}`, '1', { expirationTtl: revokedTtlSeconds() });
      } catch (err) {
        console.warn('[auth] blocklist write failed on logout:', err);
      }

      try {
        const userRow = await c.env.DB.prepare(
          "SELECT firebase_uid FROM users WHERE id = ? LIMIT 1",
        ).bind(stored.userId).first<{ firebase_uid: string }>();
        if (userRow?.firebase_uid) {
          await c.env.CACHE.delete(`user:${userRow.firebase_uid}`);
        }
      } catch (err) {
        console.warn('[auth] cache invalidation failed on logout:', err);
      }
    }

    return c.json({ success: true });
  } catch (err: unknown) {
    console.error('[auth] logout error:', err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, 500);
  }
});

authRoutes.get("/me", async (c) => {
  const userId = c.get("userId");
  const userEmail = c.get("userEmail");
  const userRole = c.get("userRole");

  if (!userId) {
    return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } }, 401);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, name, role, custom_panels FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(userId).first<{ id: string; email: string; name: string; role: string; custom_panels: string | null }>();

  if (!user) {
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
  }

  const customPanels = parseCustomPanels(user.custom_panels);

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email ?? userEmail ?? "",
        name: user.name,
        role: user.role ?? userRole,
        custom_panels: customPanels,
      },
    },
  });
});

authRoutes.put("/preferences", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } }, 401);

  let body: { custom_panels?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Body inválido" } }, 400);
  }

  if (!Array.isArray(body.custom_panels)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "custom_panels debe ser un array" } }, 400);
  }

  if (body.custom_panels.length > 20 || body.custom_panels.some((p) => typeof p !== "string" || p.length > 100)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "custom_panels excede límites permitidos" } }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE users SET custom_panels = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(JSON.stringify(body.custom_panels), userId).run();

  return c.json({ success: true, data: { custom_panels: body.custom_panels } });
});
