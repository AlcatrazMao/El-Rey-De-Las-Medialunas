import { Hono } from "hono";

import { authMiddleware } from "./middleware/auth";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { validate } from "./middleware/validate";
import { adminRoutes } from "./routes/admin";
import { auditRoutes } from "./routes/audit";
import { authRoutes } from "./routes/auth";
import { batchRoutes } from "./routes/batches";
import { branchRoutes } from "./routes/branches";
import { cashRoutes } from "./routes/cash";
import { categoryRoutes } from "./routes/categories";
import { customerRoutes } from "./routes/customers";
import { expenseRoutes } from "./routes/expenses";
import { inventoryRoutes } from "./routes/inventory";
import { offerRoutes } from "./routes/offers";
import { productionRoutes } from "./routes/production";
import { productRoutes } from "./routes/products";
import { purchaseRoutes } from "./routes/purchases";
import { reportRoutes } from "./routes/reports";
import { salesRoutes } from "./routes/sales";
import { supplierRoutes } from "./routes/suppliers";
import { supplyRequestRoutes } from "./routes/supply-requests";
import { syncRoutes } from "./routes/sync";
import { uploadRoutes } from "./routes/uploads";
import type { Env, Variables } from "./types/bindings";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", corsMiddleware());
// SECURITY: rate-limit va DESPUÉS de auth para que la key sea userId en lugar
// de IP. Si el rate-limit se aplica antes de auth, un atacante desde una
// red corporativa (NAT compartido) agota el límite de toda la sucursal y
// hace DoS del login. Las rutas públicas (/auth/login, /auth/refresh, /health)
// tienen sus propios rate-limits internos por IP + email hash.
app.use("*", authMiddleware());
app.use("*", rateLimitMiddleware());
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
app.route("/api/v2/batches", batchRoutes);
app.route("/api/v2/offers", offerRoutes);
app.route("/api/v1/admin", adminRoutes);

app.get("/api/v1/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    app: "El Rey De Las Medialunas API",
    version: "0.1.0",
  });
});

export { app, validate };
