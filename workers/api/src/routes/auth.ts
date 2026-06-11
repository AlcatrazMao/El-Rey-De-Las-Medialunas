import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /api/v1/auth/login — validate Firebase token against D1
authRoutes.post("/login", async (c) => {
  try {
    const { idToken } = await c.req.json<{ idToken: string }>();
    if (!idToken) return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "idToken required" } }, 400);

    // 1. Verify Firebase token — decode JWT to get uid, optionally validate via API
    let uid: string;
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      const payload = JSON.parse(atob(parts[1]!));
      uid = payload.sub || payload.user_id;
      if (!uid) throw new Error('No uid in token');
      // Check expiry
      if (payload.exp * 1000 < Date.now()) {
        return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token expirado" } }, 401);
      }
    } catch {
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token Firebase inválido" } }, 401);
    }

    // 2. Check D1 for user role
    const dbUser = await c.env.DB.prepare(
      "SELECT id, email, name, role FROM users WHERE firebase_uid = ? AND deleted_at IS NULL LIMIT 1"
    ).bind(uid).first<{ id: string; email: string; name: string; role: string }>();

    if (!dbUser) {
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "Usuario no registrado en el sistema" } }, 403);
    }

    return c.json({
      success: true,
      data: {
        user: { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role },
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } }, 500);
  }
});

authRoutes.post("/refresh", async (c) => {
  return c.json({ success: true, data: { message: "Refresh endpoint" } });
});

authRoutes.post("/logout", async (c) => {
  return c.json({ success: true, data: { message: "Logout endpoint" } });
});

authRoutes.get("/me", async (c) => {
  return c.json({ success: true, data: { message: "Me endpoint" } });
});
