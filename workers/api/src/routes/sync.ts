import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

syncRoutes.post("/push", async (c) => {
  return c.json({
    success: true,
    data: {
      processed: 0,
      failed: 0,
    },
    message: "Sync push endpoint",
  });
});

syncRoutes.post("/pull", async (c) => {
  return c.json({
    success: true,
    data: {
      operations: [],
      server_timestamp: new Date().toISOString(),
    },
    message: "Sync pull endpoint",
  });
});
