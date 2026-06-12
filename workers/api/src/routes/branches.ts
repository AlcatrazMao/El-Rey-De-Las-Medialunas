import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const branchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

branchRoutes.get("/", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Branches list endpoint",
  });
});

branchRoutes.get("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Branch details endpoint",
  });
});

branchRoutes.post("/", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create branch endpoint",
    },
  }, 201);
});

branchRoutes.put("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Update branch endpoint",
  });
});

branchRoutes.delete("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Delete branch endpoint",
  });
});
