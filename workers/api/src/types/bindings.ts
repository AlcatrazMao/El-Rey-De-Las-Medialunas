import type { Role } from "@medialunas/shared";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  INVENTORY_QUEUE: Queue<unknown>;
  REPORTS_QUEUE: Queue<unknown>;
  FIREBASE_SERVICE_ACCOUNT?: string;
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
}
