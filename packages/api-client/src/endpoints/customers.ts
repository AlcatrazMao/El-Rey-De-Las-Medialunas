import type {
  Customer,
  CustomerResponse,
  CustomersResponse,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  Sale,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";
import type { CustomerDebt } from "../types";

export interface CustomerFilters {
  search?: string;
  type?: string;
  is_active?: boolean;
  page?: number;
  limit?: number;
}

export interface CustomerSaleFilters {
  from_date?: string;
  to_date?: string;
  limit?: number;
}

export class CustomerEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(filters?: CustomerFilters): Promise<CustomersResponse> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<CustomersResponse>("/api/v1/customers", { params });
  }

  async getById(id: string): Promise<Customer> {
    const response = await this.client.get<CustomerResponse>(`/api/v1/customers/${id}`);
    return response.data!;
  }

  async create(data: CreateCustomerRequest): Promise<Customer> {
    const response = await this.client.post<CustomerResponse>("/api/v1/customers", data);
    return response.data!;
  }

  async update(id: string, data: UpdateCustomerRequest): Promise<Customer> {
    const response = await this.client.put<CustomerResponse>(`/api/v1/customers/${id}`, data);
    return response.data!;
  }

  async getSales(id: string, filters?: CustomerSaleFilters): Promise<Sale[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: Sale[] }>(
      `/api/v1/customers/${id}/sales`,
      { params },
    );
    return response.data;
  }

  async getDebt(id: string): Promise<CustomerDebt> {
    const response = await this.client.get<{ success: boolean; data: CustomerDebt }>(
      `/api/v1/customers/${id}/debt`,
    );
    return response.data;
  }
}
