import { createApiClient } from "@medialunas/api-client";

// API Worker URL — configurable per environment
export const API_URL = import.meta.env.VITE_API_URL || "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

let client: ReturnType<typeof createApiClient> | null = null;

export function getApi() {
  if (!client) {
    client = createApiClient({
      baseUrl: API_URL,
      getToken: () => localStorage.getItem("firebase_token") || "",
      onUnauthorized: () => {
        // Token expired — let Firebase handle it
        localStorage.removeItem("firebase_token");
      },
    });
  }
  return client;
}
