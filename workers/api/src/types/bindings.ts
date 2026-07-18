import type { Role } from "@medialunas/shared";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  INVENTORY_QUEUE: Queue<unknown>;
  REPORTS_QUEUE: Queue<unknown>;
  IMAGES_INTERNAL_TOKEN: string;
  JWT_SECRET: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  FIREBASE_API_KEY?: string;
  APP_ENV?: string;
  APP_NAME?: string;
}

export interface Variables {
  userId: string;
  userRole: Role;
  branchId: string;
  firebaseUid: string;
  userEmail: string;
  requestId: string;
  sessionId?: string;
  validatedBody?: unknown;
  validatedQuery?: unknown;
  validatedParams?: unknown;
  // Claims de sucursal firmados en el JWT (ver routes/auth.ts issueTokens).
  // Poblados por authMiddleware; usados por resolveBranchScope para decidir
  // qué branchId aplica según el rol (operativo -> default_branch forzado;
  // elevado -> query param validado o modo agregado).
  userBranches?: string[];
  userDefaultBranch?: string | null;
}
