import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Rate limit: 10 login attempts per minute per IP
const loginLimits = new Map<string, { count: number; reset: number }>();

// POST /api/v1/auth/login
authRoutes.post("/login", async (c) => {
  try {
    const { idToken } = await c.req.json<{ idToken: string }>();
    if (!idToken) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "idToken required" } }, 400);

    // Rate limit
    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const limit = loginLimits.get(ip);
    if (limit && now < limit.reset && limit.count >= 10) {
      return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Demasiados intentos" } }, 429);
    }
    if (!limit || now > limit.reset) loginLimits.set(ip, { count: 1, reset: now + 60000 });
    else limit.count++;

    // 1. Decode JWT
    let uid: string;
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      const payload = JSON.parse(atob(parts[1]!));
      uid = payload.sub || payload.user_id;
      if (!uid) throw new Error('No uid');
      if (payload.exp * 1000 < now) {
        return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token expirado" } }, 401);
      }
    } catch {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token inválido" } }, 401);
    }

    // 2. Check KV cache first
    let user: { id: string; email: string; name: string; role: string; custom_panels?: string | null } | null = null;
    try {
      const cached = await c.env.CACHE.get(`user:${uid}`, "json");
      if (cached) user = cached as any;
    } catch { /* cache write failed */ }

    // 3. Fallback to D1
    if (!user) {
      user = await c.env.DB.prepare(
        "SELECT id, firebase_uid, email, name, role, custom_panels FROM users WHERE firebase_uid = ? AND deleted_at IS NULL LIMIT 1"
      ).bind(uid).first<{ id: string; firebase_uid: string; email: string; name: string; role: string; custom_panels: string | null }>();

      if (!user) {
        return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado" } }, 403);
      }

      // Cache in KV for 1 hour
      try {
        await c.env.CACHE.put(`user:${uid}`, JSON.stringify(user), { expirationTtl: 3600 });
    } catch { /* KV read failed */ }
      }

    // 4. Audit log
    try {
      await c.env.DB.prepare(
        "INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, ip_address, created_at) VALUES (?, ?, 'auth.login', 'users', ?, ?, datetime('now'))"
      ).bind(crypto.randomUUID(), uid, uid, ip).run();
    } catch { /* cache write failed */ }

    let customPanels: string[] | null = null;
    try {
      if (user.custom_panels) customPanels = JSON.parse(user.custom_panels);
    } catch { /* ignore malformed JSON */ }

    return c.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role, custom_panels: customPanels },
      },
    });
  } catch (err: unknown) {
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) } }, 500);
  }
});

authRoutes.post("/refresh", async (c) => c.json({ success: true, data: { message: "Refresh" } }));
authRoutes.post("/logout", async (c) => c.json({ success: true, data: { message: "Logout" } }));
authRoutes.get("/me", async (c) => c.json({ success: true, data: { message: "Me" } }));

// PUT /api/v1/auth/preferences — persist user dashboard preferences cross-device
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
    "UPDATE users SET custom_panels = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify(body.custom_panels), userId).run();

  return c.json({ success: true, data: { custom_panels: body.custom_panels } });
});
