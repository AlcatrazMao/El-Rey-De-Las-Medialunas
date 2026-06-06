import { Hono } from "hono";
import type { Env, Variables } from "../types/bindings";

export const auditRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

auditRoutes.get("/", async (c) => {
  return c.json({
    success: true,
    data: [],
    pagination: { page: 1, limit: 50, total: 0, total_pages: 0, has_next: false, has_prev: false },
    message: "Audit log endpoint",
  });
});
