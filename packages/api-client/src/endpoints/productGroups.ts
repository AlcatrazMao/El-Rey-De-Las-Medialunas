import type {
  ProductGroup,
  ProductGroupResponse,
  ProductGroupsResponse,
  CreateProductGroupRequest,
  UpdateProductGroupRequest,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";
import type { ApiResponse } from "../types";

export class ProductGroupEndpoints {
  constructor(private client: ApiClient) {}

  async listGroups(productId: string): Promise<ProductGroup[]> {
    const response = await this.client.get<ProductGroupsResponse>(
      `/api/v1/products/${productId}/groups`,
    );
    return response.data ?? [];
  }

  async createGroup(
    productId: string,
    data: CreateProductGroupRequest,
  ): Promise<ProductGroup> {
    const response = await this.client.post<ProductGroupResponse>(
      `/api/v1/products/${productId}/groups`,
      data,
    );
    return response.data!;
  }

  async updateGroup(
    productId: string,
    groupId: string,
    data: UpdateProductGroupRequest,
  ): Promise<ProductGroup> {
    const response = await this.client.put<ProductGroupResponse>(
      `/api/v1/products/${productId}/groups/${groupId}`,
      data,
    );
    return response.data!;
  }

  async deleteGroup(productId: string, groupId: string): Promise<void> {
    await this.client.delete<ApiResponse<null>>(
      `/api/v1/products/${productId}/groups/${groupId}`,
    );
  }
}
