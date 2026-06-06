import { ApiClient } from "./client";
import { ApiError } from "./types";
import type { ApiClientOptions, RequestOptions, AuthResponse } from "./types";

import { AuthEndpoints } from "./endpoints/auth";
import { BranchEndpoints } from "./endpoints/branches";
import { CategoryEndpoints } from "./endpoints/categories";
import { ProductEndpoints } from "./endpoints/products";
import type { ProductFilters } from "./endpoints/products";
import { InventoryEndpoints } from "./endpoints/inventory";
import type {
  InventoryFilters,
  BatchFilters,
  MovementFilters,
  TransferFilters,
  CreateMovementRequest,
  CreateCountRequest,
} from "./endpoints/inventory";
import { SaleEndpoints } from "./endpoints/sales";
import type { SaleFilters } from "./endpoints/sales";
import { CustomerEndpoints } from "./endpoints/customers";
import type { CustomerFilters, CustomerSaleFilters } from "./endpoints/customers";
import { CashEndpoints } from "./endpoints/cash";
import type { CashSessionFilters } from "./endpoints/cash";
import { ProductionEndpoints } from "./endpoints/production";
import type { RecipeFilters, BatchFilters as ProductionBatchFilters, ExecuteBatchRequest } from "./endpoints/production";
import { SupplierEndpoints } from "./endpoints/suppliers";
import type { SupplierFilters } from "./endpoints/suppliers";
import { PurchaseEndpoints } from "./endpoints/purchases";
import type {
  PurchaseOrderFilters,
  CreatePurchaseOrderRequest,
  ReceiveOrderRequest,
} from "./endpoints/purchases";
import { ReportEndpoints } from "./endpoints/reports";
import type { ReportFilters, DashboardFilters } from "./endpoints/reports";
import { SyncEndpoints } from "./endpoints/sync";
import { AuditEndpoints } from "./endpoints/audit";
import type { AuditFilters } from "./endpoints/audit";

export { ApiClient, ApiError, AuthEndpoints, BranchEndpoints, CategoryEndpoints, ProductEndpoints,
  InventoryEndpoints, SaleEndpoints, CustomerEndpoints, CashEndpoints, ProductionEndpoints,
  SupplierEndpoints, PurchaseEndpoints, ReportEndpoints, SyncEndpoints, AuditEndpoints };
export type { ApiClientOptions, RequestOptions, AuthResponse, ProductFilters, InventoryFilters,
  BatchFilters, MovementFilters, TransferFilters, CreateMovementRequest, CreateCountRequest,
  SaleFilters, CustomerFilters, CustomerSaleFilters, CashSessionFilters, RecipeFilters,
  ProductionBatchFilters, ExecuteBatchRequest, SupplierFilters, PurchaseOrderFilters,
  CreatePurchaseOrderRequest, ReceiveOrderRequest, ReportFilters, DashboardFilters, AuditFilters };

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
