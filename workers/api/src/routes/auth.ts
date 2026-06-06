import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post("/login", async (c) => {
  // FIREBASE_AUTH: Login authenticates via Firebase ID token.
  // Client sends Firebase JWT, server validates it.
  // On success, creates/updates user record in D1, returns session.
  return c.json({
    success: true,
    data: {
      message: "Login endpoint — Firebase Auth integration pending",
    },
  });
});

authRoutes.post("/refresh", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Token refresh endpoint",
    },
  });
});

authRoutes.post("/validate", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Token validation endpoint",
    },
  });
});

authRoutes.post("/logout", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Logout endpoint",
    },
  });
});
