import type {
  Sale,
  SaleResponse,
  SalesResponse,
  CreateSaleRequest,
} from "@medialunas/shared/types/api";
import type { ApiClient } from "../client";
import type { ReceiptData, SaleStats } from "../types";

export interface SaleFilters {
  branch_id?: string;
  customer_id?: string;
  user_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export class SaleEndpoints {
  constructor(private client: ApiClient) {}

  async create(data: CreateSaleRequest): Promise<Sale> {
    const response = await this.client.post<SaleResponse>("/api/v1/sales", data);
    return response.data!;
  }

  async getAll(filters?: SaleFilters): Promise<SalesResponse> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<SalesResponse>("/api/v1/sales", { params });
  }

  async getById(id: string): Promise<Sale> {
    const response = await this.client.get<SaleResponse>(`/api/v1/sales/${id}`);
    return response.data!;
  }

  async voidSale(id: string, reason: string): Promise<Sale> {
    const response = await this.client.post<SaleResponse>(`/api/v1/sales/${id}/void`, {
      reason,
    });
    return response.data!;
  }

  async getStats(
    period: "daily" | "weekly" | "monthly" | "yearly",
    branchId?: string,
  ): Promise<SaleStats> {
    const params: Record<string, string | number | boolean | undefined> = { period };
    if (branchId) params.branch_id = branchId;
    const response = await this.client.get<{ success: boolean; data: SaleStats }>(
      "/api/v1/sales/stats",
      { params },
    );
    return response.data;
  }

  async getReceipt(id: string): Promise<ReceiptData> {
    const response = await this.client.get<{ success: boolean; data: ReceiptData }>(
      `/api/v1/sales/${id}/receipt`,
    );
    return response.data;
  }
}
