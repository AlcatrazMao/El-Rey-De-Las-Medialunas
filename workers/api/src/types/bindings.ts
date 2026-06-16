import type { Role } from "@medialunas/shared";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  INVENTORY_QUEUE: Queue<unknown>;
  REPORTS_QUEUE: Queue<unknown>;
  R2_CF_TOKEN: string;
  R2_ACCOUNT_ID: string;
  PRODUCT_IMAGES_URL: string;
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
}
