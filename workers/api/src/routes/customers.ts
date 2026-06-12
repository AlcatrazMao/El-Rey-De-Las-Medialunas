import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const customerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

customerRoutes.get("/", async (c) => {
  return c.json({
    success: true,
    data: [],
    pagination: { page: 1, limit: 50, total: 0, total_pages: 0, has_next: false, has_prev: false },
    message: "Customers list endpoint",
  });
});

customerRoutes.get("/search", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Customer search endpoint",
  });
});

customerRoutes.get("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Customer details endpoint",
  });
});

customerRoutes.post("/", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create customer endpoint",
    },
  }, 201);
});

customerRoutes.put("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Update customer endpoint",
  });
});

customerRoutes.get("/:id/history", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Customer purchase history endpoint",
  });
});
