export { ApiClient } from "./client";
export { ApiError } from "./types";
export type { ApiClientOptions, RequestOptions, AuthResponse } from "./types";

export { AuthEndpoints } from "./endpoints/auth";
export { BranchEndpoints } from "./endpoints/branches";
export { CategoryEndpoints } from "./endpoints/categories";
export { ProductEndpoints } from "./endpoints/products";
export type { ProductFilters } from "./endpoints/products";
export { InventoryEndpoints } from "./endpoints/inventory";
export type {
  InventoryFilters,
  BatchFilters,
  MovementFilters,
  TransferFilters,
  CreateMovementRequest,
  CreateCountRequest,
} from "./endpoints/inventory";
export { SaleEndpoints } from "./endpoints/sales";
export type { SaleFilters } from "./endpoints/sales";
export { CustomerEndpoints } from "./endpoints/customers";
export type { CustomerFilters, CustomerSaleFilters } from "./endpoints/customers";
export { CashEndpoints } from "./endpoints/cash";
export type { CashSessionFilters } from "./endpoints/cash";
export { ProductionEndpoints } from "./endpoints/production";
export type { RecipeFilters, BatchFilters as ProductionBatchFilters, ExecuteBatchRequest } from "./endpoints/production";
export { SupplierEndpoints } from "./endpoints/suppliers";
export type { SupplierFilters } from "./endpoints/suppliers";
export { PurchaseEndpoints } from "./endpoints/purchases";
export type {
  PurchaseOrderFilters,
  CreatePurchaseOrderRequest,
  ReceiveOrderRequest,
} from "./endpoints/purchases";
export { ReportEndpoints } from "./endpoints/reports";
export type { ReportFilters, DashboardFilters } from "./endpoints/reports";
export { SyncEndpoints } from "./endpoints/sync";
export { AuditEndpoints } from "./endpoints/audit";
export type { AuditFilters } from "./endpoints/audit";

import { ApiClient } from "./client";
import type { ApiClientOptions } from "./types";
import { AuthEndpoints } from "./endpoints/auth";
import { BranchEndpoints } from "./endpoints/branches";
import { CategoryEndpoints } from "./endpoints/categories";
import { ProductEndpoints } from "./endpoints/products";
import { InventoryEndpoints } from "./endpoints/inventory";
import { SaleEndpoints } from "./endpoints/sales";
import { CustomerEndpoints } from "./endpoints/customers";
import { CashEndpoints } from "./endpoints/cash";
import { ProductionEndpoints } from "./endpoints/production";
import { SupplierEndpoints } from "./endpoints/suppliers";
import { PurchaseEndpoints } from "./endpoints/purchases";
import { ReportEndpoints } from "./endpoints/reports";
import { SyncEndpoints } from "./endpoints/sync";
import { AuditEndpoints } from "./endpoints/audit";

export function createApiClient(options: ApiClientOptions) {
  const client = new ApiClient(options);
  return {
    client,
    auth: new AuthEndpoints(client),
    branches: new BranchEndpoints(client),
    categories: new CategoryEndpoints(client),
    products: new ProductEndpoints(client),
    inventory: new InventoryEndpoints(client),
    sales: new SaleEndpoints(client),
    customers: new CustomerEndpoints(client),
    cash: new CashEndpoints(client),
    production: new ProductionEndpoints(client),
    suppliers: new SupplierEndpoints(client),
    purchases: new PurchaseEndpoints(client),
    reports: new ReportEndpoints(client),
    sync: new SyncEndpoints(client),
    audit: new AuditEndpoints(client),
  };
}
