import { createMiddleware } from "hono/factory";

import type { Env, Variables } from "../types/bindings";

interface RateLimitConfig {
  windowSeconds?: number;
  maxRequests?: number;
}

// SECURITY: hash the client identifier so we don't store raw IPs as KV keys
// (PII minimisation). The first comma-separated value of X-Forwarded-For is
// the closest hop and what we should consider trustworthy on the Cloudflare
// edge; downstream proxies can append to this header.
async function hashClientKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, 32);
}

export function rateLimitMiddleware(config: RateLimitConfig = {}) {
  const { windowSeconds = 60, maxRequests = 100 } = config;

  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const xff = c.req.header("X-Forwarded-For");
    const firstHop = xff ? xff.split(",")[0]?.trim() : undefined;
    const clientKey =
      c.req.header("CF-Connecting-IP") ??
      firstHop ??
      "unknown";

    const hashed = await hashClientKey(clientKey);
    const rateLimitKey = `rate-limit:${hashed}`;

    let currentCount = 0;
    try {
      const stored = await c.env.RATE_LIMIT.get(rateLimitKey);
      currentCount = stored ? parseInt(stored, 10) : 0;
    } catch {
      // KV unavailable — allow request through
      await next();
      return;
    }

    if (currentCount >= maxRequests) {
      c.header("Retry-After", String(windowSeconds));
      c.header("X-RateLimit-Limit", String(maxRequests));
      c.header("X-RateLimit-Remaining", "0");

      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
          },
        },
        429,
      );
    }

    const newCount = currentCount + 1;
    try {
      await c.env.RATE_LIMIT.put(rateLimitKey, String(newCount), {
        expirationTtl: windowSeconds,
      });
    } catch {
      // KV write failed — proceed anyway
    }

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(maxRequests - newCount));

    await next();
  });
}
