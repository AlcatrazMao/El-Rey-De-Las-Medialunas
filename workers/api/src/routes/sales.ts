import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const salesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

salesRoutes.get("/", async (c) => {
  return c.json({
    success: true,
    data: [],
    pagination: { page: 1, limit: 50, total: 0, total_pages: 0, has_next: false, has_prev: false },
    message: "Sales list endpoint",
  });
});

salesRoutes.get("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Sale details endpoint",
  });
});

salesRoutes.post("/", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create sale endpoint",
    },
  }, 201);
});

salesRoutes.post("/:id/void", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Void sale endpoint",
  });
});

salesRoutes.post("/:id/refund", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Refund sale endpoint",
  });
});

salesRoutes.get("/:id/receipt", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Receipt download endpoint",
  });
});
