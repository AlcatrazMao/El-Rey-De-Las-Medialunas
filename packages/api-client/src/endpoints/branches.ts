import type {
  Branch,
  BranchResponse,
  BranchesResponse,
  CreateBranchRequest,
  UpdateBranchRequest,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";
import type { ApiResponse } from "../types";

export class BranchEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(active?: boolean): Promise<Branch[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (active !== undefined) params.active = active;
    const response = await this.client.get<BranchesResponse>("/api/v1/branches", { params });
    return response.data ?? [];
  }

  async getById(id: string): Promise<Branch> {
    const response = await this.client.get<BranchResponse>(`/api/v1/branches/${id}`);
    return response.data!;
  }

  async create(data: CreateBranchRequest): Promise<Branch> {
    const response = await this.client.post<BranchResponse>("/api/v1/branches", data);
    return response.data!;
  }

  async update(id: string, data: UpdateBranchRequest): Promise<Branch> {
    const response = await this.client.put<BranchResponse>(`/api/v1/branches/${id}`, data);
    return response.data!;
  }

  async delete(id: string): Promise<void> {
    await this.client.delete<ApiResponse<null>>(`/api/v1/branches/${id}`);
  }
}
