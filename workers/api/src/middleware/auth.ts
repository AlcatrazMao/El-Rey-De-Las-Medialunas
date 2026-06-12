import type { Role } from "@medialunas/shared";
import { createMiddleware } from "hono/factory";

import type { Env, Variables } from "../types/bindings";

const PUBLIC_ROUTES = [
  "/api/v1/health",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/validate",
];

interface DecodedToken {
  uid: string;
  email?: string;
  role?: Role;
}

export function authMiddleware() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const path = new URL(c.req.url).pathname;

    if (PUBLIC_ROUTES.some((route) => path.startsWith(route))) {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Token de acceso requerido" },
        },
        401,
      );
    }

    const token = authHeader.slice(7);

    let decoded: DecodedToken;
    try {
      decoded = await verifyFirebaseToken(token, c.env);
    } catch {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" },
        },
        401,
      );
    }

    const branchHeader = c.req.header("X-Branch-Id") ?? "";

    c.set("userId", decoded.uid);
    c.set("userRole", decoded.role ?? "cashier");
    c.set("branchId", branchHeader);
    c.set("firebaseUid", decoded.uid);
    c.set("userEmail", decoded.email ?? "");
    c.set("requestId", crypto.randomUUID());

    await next();
  });
}

async function verifyFirebaseToken(token: string, _env: Env): Promise<DecodedToken> {
  // FIREBASE_AUTH: This will verify the JWT via Firebase Admin SDK when configured.
  // For now, the actual token verification requires:
  //   1. Firebase project setup
  //   2. FIREBASE_SERVICE_ACCOUNT secret in Cloudflare environment
  //   3. firebase-admin initialization

  try {
    // Placeholder: in production, use firebase-admin verifyIdToken
    // const decodedToken = await admin.auth().verifyIdToken(token);
    // return { uid: decodedToken.uid, email: decodedToken.email };

    // Temporary: parse as unsigned JWT for development only
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid token format");
    }
    const payload = JSON.parse(atob(parts[1]!)) as {
      user_id?: string;
      uid?: string;
      sub?: string;
      email?: string;
    };
    return {
      uid: payload.user_id ?? payload.uid ?? payload.sub ?? "unknown",
      email: payload.email,
    };
  } catch {
    throw new Error("Token verification failed");
  }
}
