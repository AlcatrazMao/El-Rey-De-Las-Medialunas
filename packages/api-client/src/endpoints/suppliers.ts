import type {
  Supplier,
  SupplierResponse,
  SuppliersResponse,
  CreateSupplierRequest,
  UpdateSupplierRequest,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";

export interface SupplierFilters {
  search?: string;
  is_active?: boolean;
}

export class SupplierEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(filters?: SupplierFilters): Promise<Supplier[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<SuppliersResponse>("/api/v1/suppliers", { params });
    return response.data ?? [];
  }

  async create(data: CreateSupplierRequest): Promise<Supplier> {
    const response = await this.client.post<SupplierResponse>("/api/v1/suppliers", data);
    return response.data!;
  }

  async update(id: string, data: UpdateSupplierRequest): Promise<Supplier> {
    const response = await this.client.put<SupplierResponse>(`/api/v1/suppliers/${id}`, data);
    return response.data!;
  }
}
