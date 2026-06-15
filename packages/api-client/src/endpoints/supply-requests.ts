import type { ApiClient } from "../client";

export interface SupplyRequest {
  id: string;
  branch_id: string;
  user_id: string;
  type: "ingredient" | "product";
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  reason?: string | null;
  requested_by: string;
  status: "pending" | "approved" | "rejected";
  admin_memo?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSupplyRequestRequest {
  id?: string;
  type: "ingredient" | "product";
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  reason?: string;
  requested_by: string;
  branch_id?: string;
}

export interface UpdateSupplyRequestRequest {
  status: "approved" | "rejected";
  admin_memo?: string | null;
}

export interface SupplyRequestFilters {
  branch_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export class SupplyRequestEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(filters?: SupplyRequestFilters): Promise<SupplyRequest[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: SupplyRequest[] }>(
      "/api/v1/supply-requests",
      { params },
    );
    return response.data;
  }

  async getById(id: string): Promise<SupplyRequest> {
    const response = await this.client.get<{ success: boolean; data: SupplyRequest }>(
      `/api/v1/supply-requests/${id}`,
    );
    return response.data;
  }

  async create(data: CreateSupplyRequestRequest): Promise<{ id: string }> {
    const response = await this.client.post<{ success: boolean; data: { id: string } }>(
      "/api/v1/supply-requests",
      data,
    );
    return response.data;
  }

  async updateStatus(id: string, data: UpdateSupplyRequestRequest): Promise<{ id: string; status: string; updated_at: string }> {
    const response = await this.client.put<{ success: boolean; data: { id: string; status: string; updated_at: string } }>(
      `/api/v1/supply-requests/${id}`,
      data,
    );
    return response.data;
  }
}
