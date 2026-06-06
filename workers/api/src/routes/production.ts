import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const productionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

productionRoutes.get("/recipes", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Recipes list endpoint",
  });
});

productionRoutes.get("/recipes/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Recipe details endpoint",
  });
});

productionRoutes.post("/recipes", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create recipe endpoint",
    },
  }, 201);
});

productionRoutes.put("/recipes/:id", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Update recipe endpoint",
  });
});

productionRoutes.get("/batches", async (c) => {
  return c.json({
    success: true,
    data: [],
    message: "Production batches list endpoint",
  });
});

productionRoutes.post("/batches", async (c) => {
  return c.json({
    success: true,
    data: {
      message: "Create production batch endpoint",
    },
  }, 201);
});

productionRoutes.post("/batches/:id/start", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Start production batch endpoint",
  });
});

productionRoutes.post("/batches/:id/complete", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Complete production batch endpoint",
  });
});

productionRoutes.post("/batches/:id/cancel", async (c) => {
  return c.json({
    success: true,
    data: { id: c.req.param("id") },
    message: "Cancel production batch endpoint",
  });
});
