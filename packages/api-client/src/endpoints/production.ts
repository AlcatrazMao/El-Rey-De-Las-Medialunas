import type {
  Recipe,
  RecipeResponse,
  RecipesResponse,
  ProductionBatch,
  ProductionBatchResponse,
  ProductionBatchesResponse,
  CreateRecipeRequest,
  UpdateRecipeRequest,
  CreateProductionBatchRequest,
} from "@medialunas/shared/types/api";
import type { ApiClient } from "../client";
import type { ProductionPlanning } from "../types";

export interface RecipeFilters {
  product_id?: string;
  is_active?: boolean;
  branch_id?: string;
  search?: string;
}

export interface BatchFilters {
  branch_id?: string;
  recipe_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
}

export interface ExecuteBatchRequest {
  actual_quantity: number;
  waste_quantity?: number;
  notes?: string;
}

export class ProductionEndpoints {
  constructor(private client: ApiClient) {}

  async getRecipes(filters?: RecipeFilters): Promise<Recipe[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<RecipesResponse>("/api/v1/production/recipes", {
      params,
    });
    return response.data ?? [];
  }

  async getRecipe(id: string): Promise<Recipe> {
    const response = await this.client.get<RecipeResponse>(
      `/api/v1/production/recipes/${id}`,
    );
    return response.data!;
  }

  async createRecipe(data: CreateRecipeRequest): Promise<Recipe> {
    const response = await this.client.post<RecipeResponse>(
      "/api/v1/production/recipes",
      data,
    );
    return response.data!;
  }

  async updateRecipe(id: string, data: UpdateRecipeRequest): Promise<Recipe> {
    const response = await this.client.put<RecipeResponse>(
      `/api/v1/production/recipes/${id}`,
      data,
    );
    return response.data!;
  }

  async createBatch(data: CreateProductionBatchRequest): Promise<ProductionBatch> {
    const response = await this.client.post<ProductionBatchResponse>(
      "/api/v1/production/batches",
      data,
    );
    return response.data!;
  }

  async executeBatch(id: string, data: ExecuteBatchRequest): Promise<ProductionBatch> {
    const response = await this.client.post<ProductionBatchResponse>(
      `/api/v1/production/batches/${id}/execute`,
      data,
    );
    return response.data!;
  }

  async getBatches(filters?: BatchFilters): Promise<ProductionBatch[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<ProductionBatchesResponse>(
      "/api/v1/production/batches",
      { params },
    );
    return response.data ?? [];
  }

  async getPlanning(branchId: string): Promise<ProductionPlanning> {
    const response = await this.client.get<{ success: boolean; data: ProductionPlanning }>(
      "/api/v1/production/planning",
      { params: { branch_id: branchId } },
    );
    return response.data;
  }
}
