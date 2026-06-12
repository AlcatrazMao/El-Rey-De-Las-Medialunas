import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const supplierRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

supplierRoutes.get("/", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Suppliers list endpoint",
  });
});

supplierRoutes.get("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Supplier details endpoint",
  });
});

supplierRoutes.post("/", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create supplier endpoint",
    },
  }, 201);
});

supplierRoutes.put("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Update supplier endpoint",
  });
});
