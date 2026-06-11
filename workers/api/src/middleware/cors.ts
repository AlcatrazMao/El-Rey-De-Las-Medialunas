import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "../types/bindings";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://rey-de-las-medialunas.web.app",
  "https://pos.elreydelasmedialunas.com",
  "https://admin.elreydelasmedialunas.com",
  "https://tablet.elreydelasmedialunas.com",
];

export function corsMiddleware() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const origin = c.req.header("Origin") ?? "";

    if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Branch-Id, X-Client-Version");
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Max-Age", "86400");
      c.header("Vary", "Origin");
    }

    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin || ALLOWED_ORIGINS[0]!,
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id, X-Client-Version",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    await next();
  });
}
