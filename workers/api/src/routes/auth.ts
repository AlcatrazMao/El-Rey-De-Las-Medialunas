import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { signJWT } from "../utils/jwt";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_SECONDS = 28800;

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  name: string;
  role: string;
  custom_panels: string | null;
}

interface RefreshSession {
  userId: string;
  role: string;
  email: string;
  issuedAt: number;
}

async function verifyFirebaseIdToken(idToken: string, env: Env): Promise<{ uid: string; email?: string } | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  const encodedPayload = parts[1];
  if (!encodedPayload) return null;

  let payload: { user_id?: string; uid?: string; sub?: string; email?: string; exp?: number };
  try {
    payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;

  const firebaseUid = payload.user_id ?? payload.uid ?? payload.sub;
  if (!firebaseUid) return null;

  if (!env.FIREBASE_API_KEY) {
    throw new Error('FIREBASE_API_KEY not configured — cannot verify token');
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );

  if (!res.ok) return null;

  const data = await res.json<{ users?: Array<{ localId: string; email?: string; disabled?: boolean }> }>();
  const fbUser = data.users?.[0];
  if (!fbUser?.localId || fbUser.disabled) return null;

  return { uid: fbUser.localId, email: fbUser.email };
}

async function issueTokens(
  env: Env,
  user: { id: string; email: string; role: string },
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: "Bearer" }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessToken = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
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

    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    const rateLimitKey = `rate_limit:login:${ip}`;
    // Defensa contra KV corrupto: parseInt puede devolver NaN, y NaN >= 5 es
    // false (bypass del rate limit). Normalizamos a 0 si no es finito.
    const raw = await c.env.SESSIONS.get(rateLimitKey);
    const parsed = parseInt(raw ?? '0', 10);
    const attempts = Number.isFinite(parsed) ? parsed : 0;
    if (attempts >= 5) {
      return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Demasiados intentos" } }, 429);
    }
    await c.env.SESSIONS.put(rateLimitKey, String(attempts + 1), { expirationTtl: 900 });

    const verified = await verifyFirebaseIdToken(idToken, c.env);
    if (!verified) {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" } }, 401);
    }

    // Reset rate limit on successful Firebase verification so legitimate users
    // are not penalised by past failed attempts.
    try {
      await c.env.SESSIONS.delete(rateLimitKey);
    } catch (err) {
      console.warn('[auth] failed to reset login rate limit:', err);
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
        return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
      }

      try {
        await c.env.CACHE.put(`user:${uid}`, JSON.stringify(user), { expirationTtl: 3600 });
      } catch (err) {
        console.warn('[auth] cache write failed for user:', err);
      }
    }

    try {
      await c.env.DB.prepare(
        "INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, ip_address, created_at) VALUES (?, ?, 'auth.login', 'users', ?, ?, datetime('now'))",
      ).bind(crypto.randomUUID(), user.id, user.id, ip).run();
    } catch (err) {
      console.warn('[auth] audit_log insert failed on login:', err);
    }

    const tokens = await issueTokens(c.env, { id: user.id, email: user.email, role: user.role });

    let customPanels: string[] | null = null;
    try {
      if (user.custom_panels) customPanels = JSON.parse(user.custom_panels);
    } catch (err) {
      console.warn('[auth] failed to parse custom_panels JSON on login:', err);
    }

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
    // Add to short-lived revocation blocklist so concurrent in-flight requests are rejected
    await c.env.SESSIONS.put(`revoked:${refresh_token}`, '1', { expirationTtl: 60 });

    // Now issue new tokens
    const tokens = await issueTokens(c.env, { id: stored.userId, email: stored.email, role: stored.role });

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

  let customPanels: string[] | null = null;
  try {
    if (user.custom_panels) customPanels = JSON.parse(user.custom_panels);
  } catch (err) {
    console.warn('[auth] failed to parse custom_panels JSON on /me:', err);
  }

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
