import type {
  Branch,
  User,
  Category,
  Product,
  ProductPrice,
  InventoryItem,
  StockMovement,
  Sale,
  Customer,
  CashSession,
  CashMovement,
  Recipe,
  RecipeIngredient,
  ProductionBatch,
  Supplier,
  TransferOrder,
  AuditEntry,
  SyncLog,
} from "./models";

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    timestamp: string;
    branch_id?: string;
    request_id?: string;
  };
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
}

export interface LoginRequest {
  id_token: string;
  branch_id: string;
}

export interface LoginResponse extends ApiResponse<{ tokens: AuthTokens; user: User }> {}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse extends ApiResponse<{ tokens: AuthTokens }> {}

export interface ValidateTokenRequest {
  access_token: string;
}

export interface ValidateTokenResponse extends ApiResponse<{ valid: boolean; user_id: string }> {}

export type CreateBranchRequest = Omit<Branch, "id" | "created_at" | "updated_at" | "deleted_at">;
export type UpdateBranchRequest = Partial<CreateBranchRequest>;
export type BranchResponse = ApiResponse<Branch>;
export type BranchesResponse = ApiResponse<Branch[]>;

export type CreateCategoryRequest = Omit<
  Category,
  "id" | "created_at" | "updated_at" | "deleted_at"
>;
export type UpdateCategoryRequest = Partial<CreateCategoryRequest>;
export type CategoryResponse = ApiResponse<Category>;
export type CategoriesResponse = ApiResponse<Category[]>;

export type CreateProductRequest = Omit<
  Product,
  "id" | "created_at" | "updated_at" | "deleted_at"
>;
export type UpdateProductRequest = Partial<CreateProductRequest>;
export type ProductResponse = ApiResponse<Product>;
export type ProductsResponse = PaginatedResponse<Product>;

export type CreateProductPriceRequest = Omit<ProductPrice, "id" | "created_at" | "updated_at">;
export type UpdateProductPriceRequest = Partial<
  Pick<ProductPrice, "price" | "is_active" | "start_date" | "end_date">
>;

export type InventoryItemResponse = ApiResponse<InventoryItem>;
export type InventoryResponse = PaginatedResponse<InventoryItem>;

export interface StockMovementResponse extends ApiResponse<StockMovement> {}
export interface StockMovementsResponse extends ApiResponse<StockMovement[]> {}

export interface CreateSaleItemRequest {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  tax_rate?: number;
  tax_amount?: number;
  notes?: string;
}

export interface CreateSalePaymentRequest {
  payment_method: string;
  amount: number;
  reference?: string;
}

export interface CreateSaleRequest {
  branch_id: string;
  customer_id?: string;
  items: CreateSaleItemRequest[];
  payments: CreateSalePaymentRequest[];
  notes?: string;
  subtotal?: number;
  tax_total?: number;
  discount_total?: number;
  total?: number;
}

export type SaleResponse = ApiResponse<Sale>;
export type SalesResponse = PaginatedResponse<Sale>;

export type CreateCustomerRequest = Omit<
  Customer,
  "id" | "created_at" | "updated_at" | "deleted_at"
>;
export type UpdateCustomerRequest = Partial<CreateCustomerRequest>;
export type CustomerResponse = ApiResponse<Customer>;
export type CustomersResponse = PaginatedResponse<Customer>;

export interface OpenCashSessionRequest {
  id?: string;
  branch_id: string;
  opening_amount: number;
  notes?: string | null;
}

export interface CloseCashSessionRequest {
  closing_amount: number;
  expected_amount?: number;
  notes?: string | null;
}

export interface CashMovementRequest {
  type: string;
  amount: number;
  description?: string;
  category?: string;
  reference_id?: string;
}

export type CashSessionResponse = ApiResponse<CashSession>;
export type CashMovementsResponse = ApiResponse<CashMovement[]>;

export type CreateRecipeRequest = Omit<
  Recipe,
  "id" | "created_at" | "updated_at" | "ingredients"
> & {
  ingredients: Omit<RecipeIngredient, "id" | "recipe_id" | "created_at">[];
};

export type UpdateRecipeRequest = Partial<CreateRecipeRequest>;
export type RecipeResponse = ApiResponse<Recipe>;
export type RecipesResponse = ApiResponse<Recipe[]>;

export interface CreateProductionBatchRequest {
  recipe_id: string;
  branch_id: string;
  planned_quantity: number;
  notes?: string;
}

export type ProductionBatchResponse = ApiResponse<ProductionBatch>;
export type ProductionBatchesResponse = ApiResponse<ProductionBatch[]>;

export type CreateSupplierRequest = Omit<
  Supplier,
  "id" | "created_at" | "updated_at" | "deleted_at"
>;
export type UpdateSupplierRequest = Partial<CreateSupplierRequest>;
export type SupplierResponse = ApiResponse<Supplier>;
export type SuppliersResponse = ApiResponse<Supplier[]>;

export type CreateTransferOrderRequest = {
  source_branch_id: string;
  destination_branch_id: string;
  items: { product_id: string; quantity: number; notes?: string }[];
  notes?: string;
};

export type TransferOrderResponse = ApiResponse<TransferOrder>;
export type TransferOrdersResponse = ApiResponse<TransferOrder[]>;

export interface SyncPushRequest {
  operations: {
    client_id: string;
    entity_type: string;
    operation: "create" | "update" | "delete";
    data: Record<string, unknown>;
    client_timestamp: string;
  }[];
  branch_id: string;
}

export interface SyncPushResponse extends ApiResponse<{ processed: number; failed: number }> {}

export interface SyncPullRequest {
  branch_id: string;
  last_sync_timestamp?: string;
  entity_types?: string[];
}

export interface SyncPullResponse
  extends ApiResponse<{
    operations: SyncLog[];
    server_timestamp: string;
  }> {}

export type AuditEntriesResponse = PaginatedResponse<AuditEntry>;

export type {
  Branch,
  User,
  UserBranch,
  Category,
  Product,
  ProductAlias,
  ProductPrice,
  InventoryItem,
  InventoryBatch,
  StockMovement,
  Sale,
  SaleItem,
  SalePayment,
  Customer,
  CashSession,
  CashMovement,
  Recipe,
  RecipeIngredient,
  ProductionBatch,
  Supplier,
  PurchaseOrder,
  PurchaseOrderItem,
  TransferOrder,
  TransferOrderItem,
  AuditEntry,
  SyncLog,
  Session,
  Timestamps,
} from "./models";
