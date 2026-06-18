import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";
import { signJWT } from "../utils/jwt";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const loginLimits = new Map<string, { count: number; reset: number }>();

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

  if (env.FIREBASE_API_KEY) {
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

  return { uid: firebaseUid, email: payload.email };
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
    if (!idToken) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "idToken required" } }, 400);

    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const limit = loginLimits.get(ip);
    if (limit && now < limit.reset && limit.count >= 10) {
      return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Demasiados intentos" } }, 429);
    }
    if (!limit || now > limit.reset) loginLimits.set(ip, { count: 1, reset: now + 60000 });
    else limit.count++;

    const verified = await verifyFirebaseIdToken(idToken, c.env);
    if (!verified) {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" } }, 401);
    }

    const uid = verified.uid;

    let user: UserRow | null = null;
    try {
      const cached = await c.env.CACHE.get(`user:${uid}`, "json");
      if (cached) user = cached as UserRow;
    } catch { /* cache miss */ }

    if (!user) {
      user = await c.env.DB.prepare(
        "SELECT id, firebase_uid, email, name, role, custom_panels FROM users WHERE firebase_uid = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(uid).first<UserRow>();

      if (!user) {
        return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
      }

      try {
        await c.env.CACHE.put(`user:${uid}`, JSON.stringify(user), { expirationTtl: 3600 });
      } catch { /* non-critical */ }
    }

    try {
      await c.env.DB.prepare(
        "INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, ip_address, created_at) VALUES (?, ?, 'auth.login', 'users', ?, ?, datetime('now'))",
      ).bind(crypto.randomUUID(), user.id, user.id, ip).run();
    } catch { /* non-critical */ }

    const tokens = await issueTokens(c.env, { id: user.id, email: user.email, role: user.role });

    let customPanels: string[] | null = null;
    try {
      if (user.custom_panels) customPanels = JSON.parse(user.custom_panels);
    } catch { /* ignore */ }

    return c.json({
      success: true,
      data: {
        tokens,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, custom_panels: customPanels },
      },
    });
  } catch (err: unknown) {
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) } }, 500);
  }
});

authRoutes.post("/refresh", async (c) => {
  try {
    const { refresh_token } = await c.req.json<{ refresh_token: string }>();
    if (!refresh_token) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "refresh_token requerido" } }, 400);
    }

    const key = `rt:${refresh_token}`;
    const stored = await c.env.SESSIONS.get(key, "json") as RefreshSession | null;
    if (!stored) {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Refresh token inválido o expirado" } }, 401);
    }

    await c.env.SESSIONS.delete(key);

    const tokens = await issueTokens(c.env, { id: stored.userId, email: stored.email, role: stored.role });

    return c.json({ success: true, data: { tokens } });
  } catch (err: unknown) {
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) } }, 500);
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
      } catch { /* non-critical */ }
    }

    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) } }, 500);
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
  } catch { /* ignore */ }

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

  await c.env.DB.prepare(
    "UPDATE users SET custom_panels = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(JSON.stringify(body.custom_panels), userId).run();

  return c.json({ success: true, data: { custom_panels: body.custom_panels } });
});
