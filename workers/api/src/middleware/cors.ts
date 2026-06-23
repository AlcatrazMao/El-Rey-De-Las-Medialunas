import { cors } from "hono/cors";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://rey-de-las-medialunas.web.app",
  "https://pos.elreydelasmedialunas.com",
  "https://admin.elreydelasmedialunas.com",
  "https://tablet.elreydelasmedialunas.com",
];

export function corsMiddleware() {
  return cors({
    // Fix 6: null es ambiguo — algunos toolings lo interpretan distinto. La
    // implementación de Hono cors hace `if (allowOrigin)` (truthy check), con
    // lo cual null, undefined y '' son equivalentes para denegar. Usamos
    // undefined que está explícito en el tipo del callback y es inequívoco.
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Branch-Id", "X-Client-Version"],
    credentials: true,
    maxAge: 86400,
  });
}
