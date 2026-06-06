import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const cashRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

cashRoutes.get("/sessions", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Cash sessions list endpoint",
  });
});

cashRoutes.get("/sessions/current", async (c) => {
  return c.json({
    success: true,
    data: null,
    message: "Current cash session endpoint",
  });
});

cashRoutes.post("/sessions/open", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Open cash session endpoint",
    },
  }, 201);
});

cashRoutes.post("/sessions/:id/close", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Close cash session endpoint",
  });
});

cashRoutes.get("/movements", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Cash movements list endpoint",
  });
});

cashRoutes.post("/movements", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create cash movement endpoint",
    },
  }, 201);
});
