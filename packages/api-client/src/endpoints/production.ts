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

export interface CompleteBatchRequest {
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

  async getBatches(filters?: BatchFilters): Promise<ProductionBatch[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<ProductionBatchesResponse>(
      "/api/v1/production/batches",
      { params },
    );
    return response.data ?? [];
  }

  // Inicia el lote: consume ingredientes de inventario. El backend no lee body.
  async startBatch(id: string): Promise<ProductionBatch> {
    const response = await this.client.post<ProductionBatchResponse>(
      `/api/v1/production/batches/${id}/start`,
    );
    return response.data!;
  }

  // Completa el lote: agrega el producto terminado al inventario.
  async completeBatch(id: string, data: CompleteBatchRequest): Promise<ProductionBatch> {
    const response = await this.client.post<ProductionBatchResponse>(
      `/api/v1/production/batches/${id}/complete`,
      data,
    );
    return response.data!;
  }

  // Cancela el lote (revierte consumo si estaba in_progress). El backend no lee
  // body, por eso no enviamos payload.
  async cancelBatch(id: string): Promise<ProductionBatch> {
    const response = await this.client.post<ProductionBatchResponse>(
      `/api/v1/production/batches/${id}/cancel`,
    );
    return response.data!;
  }
}
