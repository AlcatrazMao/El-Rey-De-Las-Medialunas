import type {
  ApiResponse,
  Branch,
  BranchResponse,
  BranchesResponse,
  CreateBranchRequest,
  UpdateBranchRequest,
  Category,
  CategoryResponse,
  CategoriesResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  Product,
  ProductResponse,
  ProductsResponse,
  CreateProductRequest,
  UpdateProductRequest,
  ProductPrice,
  CreateProductPriceRequest,
  UpdateProductPriceRequest,
  InventoryItem,
  InventoryItemResponse,
  InventoryResponse,
  StockMovement,
  StockMovementResponse,
  StockMovementsResponse,
  Sale,
  SaleResponse,
  SalesResponse,
  CreateSaleRequest,
  Customer,
  CustomerResponse,
  CustomersResponse,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  CashSession,
  CashSessionResponse,
  CashMovementsResponse,
  CashMovement,
  OpenCashSessionRequest,
  CloseCashSessionRequest,
  CashMovementRequest,
  Recipe,
  RecipeResponse,
  RecipesResponse,
  CreateRecipeRequest,
  UpdateRecipeRequest,
  ProductionBatch,
  ProductionBatchResponse,
  ProductionBatchesResponse,
  CreateProductionBatchRequest,
  Supplier,
  SupplierResponse,
  SuppliersResponse,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  PurchaseOrder,
  TransferOrder,
  TransferOrderResponse,
  TransferOrdersResponse,
  CreateTransferOrderRequest,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullRequest,
  SyncPullResponse,
  AuditEntry,
  AuditEntriesResponse,
  PaginationParams,
  PaginatedResponse,
} from "@medialunas/shared/types/api";

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  /**
   * Called when a request fails with 401 Unauthorized. Should attempt to
   * refresh the access token and return `true` if a fresh token is now
   * usable (the original request will be retried once), or `false` if the
   * refresh failed (the original 401 ApiError will be propagated).
   */
  onUnauthorized?: () => boolean | Promise<boolean>;
  retries?: number;
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    branch_id?: string;
  };
}

export interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

export interface SaleStats {
  total_sales: number;
  total_revenue: number;
  average_ticket: number;
  top_products: { product_id: string; name: string; quantity: number; revenue: number }[];
  sales_by_hour: { hour: number; count: number }[];
  sales_by_day: { date: string; count: number; revenue: number }[];
}

export interface ReceiptData {
  id: string;
  sale_number: number;
  branch_name: string;
  branch_address?: string;
  created_at: string;
  subtotal: number;
  tax_total: number;
  total: number;
  items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  payments: {
    payment_method: string;
    amount: number;
  }[];
}

export interface CustomerDebt {
  customer_id: string;
  current_debt: number;
  credit_limit: number;
  available_credit: number;
}

export interface ProductionPlanning {
  branch_id: string;
  planned_date: string;
  recipes: {
    recipe_id: string;
    name: string;
    planned_quantity: number;
    needed_ingredients: { product_id: string; name: string; required: number; available: number }[];
  }[];
}

export type SalesReport = Record<string, unknown>;
export type InventoryReport = Record<string, unknown>;
export type ProductionReport = Record<string, unknown>;
export type CashReport = Record<string, unknown>;
export type Analytics = Record<string, unknown>;
export type Dashboard = Record<string, unknown>;

export type {
  ApiResponse,
  Branch,
  BranchResponse,
  BranchesResponse,
  CreateBranchRequest,
  UpdateBranchRequest,
  Category,
  CategoryResponse,
  CategoriesResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  Product,
  ProductResponse,
  ProductsResponse,
  CreateProductRequest,
  UpdateProductRequest,
  ProductPrice,
  CreateProductPriceRequest,
  UpdateProductPriceRequest,
  InventoryItem,
  InventoryItemResponse,
  InventoryResponse,
  StockMovement,
  StockMovementResponse,
  StockMovementsResponse,
  Sale,
  SaleResponse,
  SalesResponse,
  CreateSaleRequest,
  Customer,
  CustomerResponse,
  CustomersResponse,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  CashSession,
  CashSessionResponse,
  CashMovementsResponse,
  CashMovement,
  OpenCashSessionRequest,
  CloseCashSessionRequest,
  CashMovementRequest,
  Recipe,
  RecipeResponse,
  RecipesResponse,
  CreateRecipeRequest,
  UpdateRecipeRequest,
  ProductionBatch,
  ProductionBatchResponse,
  ProductionBatchesResponse,
  CreateProductionBatchRequest,
  Supplier,
  SupplierResponse,
  SuppliersResponse,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  PurchaseOrder,
  TransferOrder,
  TransferOrderResponse,
  TransferOrdersResponse,
  CreateTransferOrderRequest,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullRequest,
  SyncPullResponse,
  AuditEntry,
  AuditEntriesResponse,
  PaginationParams,
  PaginatedResponse,
};
