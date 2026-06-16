import { Hono } from "hono";

import { authMiddleware } from "./middleware/auth";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { validate } from "./middleware/validate";
import { auditRoutes } from "./routes/audit";
import { uploadRoutes } from "./routes/uploads";
import { authRoutes } from "./routes/auth";
import { branchRoutes } from "./routes/branches";
import { cashRoutes } from "./routes/cash";
import { categoryRoutes } from "./routes/categories";
import { customerRoutes } from "./routes/customers";
import { expenseRoutes } from "./routes/expenses";
import { inventoryRoutes } from "./routes/inventory";
import { productionRoutes } from "./routes/production";
import { productRoutes } from "./routes/products";
import { purchaseRoutes } from "./routes/purchases";
import { reportRoutes } from "./routes/reports";
import { salesRoutes } from "./routes/sales";
import { supplierRoutes } from "./routes/suppliers";
import { supplyRequestRoutes } from "./routes/supply-requests";
import { syncRoutes } from "./routes/sync";
import type { Env, Variables } from "./types/bindings";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", corsMiddleware());
app.use("*", rateLimitMiddleware());
app.use("*", authMiddleware());
app.onError(errorHandler);

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/branches", branchRoutes);
app.route("/api/v1/categories", categoryRoutes);
app.route("/api/v1/products", productRoutes);
app.route("/api/v1/inventory", inventoryRoutes);
app.route("/api/v1/sales", salesRoutes);
app.route("/api/v1/customers", customerRoutes);
app.route("/api/v1/cash", cashRoutes);
app.route("/api/v1/production", productionRoutes);
app.route("/api/v1/suppliers", supplierRoutes);
app.route("/api/v1/purchases", purchaseRoutes);
app.route("/api/v1/reports", reportRoutes);
app.route("/api/v1/sync", syncRoutes);
app.route("/api/v1/audit", auditRoutes);
app.route("/api/v1/supply-requests", supplyRequestRoutes);
app.route("/api/v1/expenses", expenseRoutes);
app.route("/api/v1/upload", uploadRoutes);

app.get("/api/v1/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    app: "El Rey De Las Medialunas API",
    version: "0.1.0",
  });
});

export { app, validate };
