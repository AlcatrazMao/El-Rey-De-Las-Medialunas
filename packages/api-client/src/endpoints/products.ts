import type {
  Product,
  ProductResponse,
  ProductsResponse,
  ProductPrice,
  CreateProductRequest,
  UpdateProductRequest,
  CreateProductPriceRequest,
} from "@medialunas/shared/types/api";
import type { ApiClient } from "../client";
import type { ApiResponse, ImportResult } from "../types";

export interface ProductFilters {
  branch_id?: string;
  category_id?: string;
  is_active?: boolean;
  is_producible?: boolean;
  is_raw_material?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export class ProductEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(filters?: ProductFilters): Promise<ProductsResponse> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<ProductsResponse>("/api/v1/products", { params });
  }

  async getById(id: string): Promise<Product> {
    const response = await this.client.get<ProductResponse>(`/api/v1/products/${id}`);
    return response.data!;
  }

  async create(data: CreateProductRequest): Promise<Product> {
    const response = await this.client.post<ProductResponse>("/api/v1/products", data);
    return response.data!;
  }

  async update(id: string, data: UpdateProductRequest): Promise<Product> {
    const response = await this.client.put<ProductResponse>(`/api/v1/products/${id}`, data);
    return response.data!;
  }

  async delete(id: string): Promise<void> {
    await this.client.delete<ApiResponse<null>>(`/api/v1/products/${id}`);
  }

  async search(q: string, branchId?: string, limit?: number): Promise<Product[]> {
    const params: Record<string, string | number | boolean | undefined> = { q };
    if (branchId) params.branch_id = branchId;
    if (limit) params.limit = limit;
    const response = await this.client.get<{ success: boolean; data: Product[] }>(
      "/api/v1/products/search",
      { params },
    );
    return response.data;
  }

  async import(file: File): Promise<ImportResult> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await this.client.upload<{ success: boolean; data: ImportResult }>(
      "/api/v1/products/import",
      formData,
    );
    return response.data;
  }

  async getPrices(id: string): Promise<ProductPrice[]> {
    const response = await this.client.get<{ success: boolean; data: ProductPrice[] }>(
      `/api/v1/products/${id}/prices`,
    );
    return response.data;
  }

  async createPrice(id: string, data: CreateProductPriceRequest): Promise<ProductPrice> {
    const response = await this.client.post<{ success: boolean; data: ProductPrice }>(
      `/api/v1/products/${id}/prices`,
      data,
    );
    return response.data;
  }
}
