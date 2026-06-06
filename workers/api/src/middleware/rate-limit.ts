import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "../types/bindings";

interface RateLimitConfig {
  windowSeconds?: number;
  maxRequests?: number;
}

export function rateLimitMiddleware(config: RateLimitConfig = {}) {
  const { windowSeconds = 60, maxRequests = 100 } = config;

  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const clientKey =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      "unknown";

    const rateLimitKey = `rate-limit:${clientKey}`;

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
