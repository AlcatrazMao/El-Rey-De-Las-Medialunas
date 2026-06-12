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
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Branch-Id", "X-Client-Version"],
    credentials: true,
    maxAge: 86400,
  });
}
