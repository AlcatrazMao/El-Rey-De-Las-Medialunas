import { Hono } from "hono";

import type { Env, Variables } from "../types/bindings";

export const categoryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

categoryRoutes.get("/", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Categories list endpoint",
  });
});

categoryRoutes.get("/tree", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Category tree endpoint",
  });
});

categoryRoutes.get("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Category details endpoint",
  });
});

categoryRoutes.post("/", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create category endpoint",
    },
  }, 201);
});

categoryRoutes.put("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Update category endpoint",
  });
});

categoryRoutes.delete("/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Delete category endpoint",
  });
});
