import type {
  Category,
  CategoryResponse,
  CategoriesResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from "@medialunas/shared/types/api";
import type { ApiClient } from "../client";
import type { ApiResponse } from "../types";

export class CategoryEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(
    branchId?: string,
    parentId?: string,
    active?: boolean,
  ): Promise<Category[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (branchId) params.branch_id = branchId;
    if (parentId) params.parent_id = parentId;
    if (active !== undefined) params.active = active;
    const response = await this.client.get<CategoriesResponse>("/api/v1/categories", { params });
    return response.data ?? [];
  }

  async getById(id: string): Promise<Category> {
    const response = await this.client.get<CategoryResponse>(`/api/v1/categories/${id}`);
    return response.data!;
  }

  async create(data: CreateCategoryRequest): Promise<Category> {
    const response = await this.client.post<CategoryResponse>("/api/v1/categories", data);
    return response.data!;
  }

  async update(id: string, data: UpdateCategoryRequest): Promise<Category> {
    const response = await this.client.put<CategoryResponse>(`/api/v1/categories/${id}`, data);
    return response.data!;
  }

  async delete(id: string): Promise<void> {
    await this.client.delete<ApiResponse<null>>(`/api/v1/categories/${id}`);
  }
}
