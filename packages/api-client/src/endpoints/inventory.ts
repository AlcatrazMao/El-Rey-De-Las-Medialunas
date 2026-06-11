import type {
  InventoryItem,
  InventoryBatch,
  StockMovement,
  StockMovementResponse,
  TransferOrder,
  TransferOrderResponse,
  TransferOrdersResponse,
  CreateTransferOrderRequest,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";
import type { PaginatedResponse } from "../types";

export interface InventoryFilters {
  branch_id?: string;
  category_id?: string;
  product_id?: string;
  low_stock?: boolean;
  page?: number;
  limit?: number;
}

export interface BatchFilters {
  branch_id?: string;
  product_id?: string;
  supplier_id?: string;
  with_remaining?: boolean;
}

export interface MovementFilters {
  branch_id?: string;
  product_id?: string;
  movement_type?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

export interface TransferFilters {
  source_branch_id?: string;
  destination_branch_id?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface CreateMovementRequest {
  product_id: string;
  branch_id: string;
  batch_id?: string;
  movement_type: string;
  quantity: number;
  unit_cost_at_time?: number;
  reason?: string;
  reference_type?: string;
  reference_id?: string;
  notes?: string;
}

export interface CreateCountRequest {
  branch_id: string;
  items: { product_id: string; counted_quantity: number; notes?: string }[];
  notes?: string;
}

export class InventoryEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(filters?: InventoryFilters): Promise<PaginatedResponse<InventoryItem>> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<PaginatedResponse<InventoryItem>>("/api/v1/inventory", { params });
  }

  async getBatches(filters?: BatchFilters): Promise<InventoryBatch[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: InventoryBatch[] }>(
      "/api/v1/inventory/batches",
      { params },
    );
    return response.data;
  }

  async getMovements(filters?: MovementFilters): Promise<PaginatedResponse<StockMovement>> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<PaginatedResponse<StockMovement>>("/api/v1/inventory/movements", {
      params,
    });
  }

  async createMovement(data: CreateMovementRequest): Promise<StockMovement> {
    const response = await this.client.post<StockMovementResponse>(
      "/api/v1/inventory/movements",
      data,
    );
    return response.data!;
  }

  async getTransfers(filters?: TransferFilters): Promise<TransferOrder[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<TransferOrdersResponse>(
      "/api/v1/inventory/transfers",
      { params },
    );
    return response.data ?? [];
  }

  async createTransfer(data: CreateTransferOrderRequest): Promise<TransferOrder> {
    const response = await this.client.post<TransferOrderResponse>(
      "/api/v1/inventory/transfers",
      data,
    );
    return response.data!;
  }

  async approveTransfer(id: string): Promise<TransferOrder> {
    const response = await this.client.post<TransferOrderResponse>(
      `/api/v1/inventory/transfers/${id}/approve`,
    );
    return response.data!;
  }

  async shipTransfer(
    id: string,
    data: { shipped_items: { item_id: string; quantity: number }[]; notes?: string },
  ): Promise<TransferOrder> {
    const response = await this.client.post<TransferOrderResponse>(
      `/api/v1/inventory/transfers/${id}/ship`,
      data,
    );
    return response.data!;
  }

  async receiveTransfer(
    id: string,
    data: { received_items: { item_id: string; quantity: number; notes?: string }[]; notes?: string },
  ): Promise<TransferOrder> {
    const response = await this.client.post<TransferOrderResponse>(
      `/api/v1/inventory/transfers/${id}/receive`,
      data,
    );
    return response.data!;
  }

  async rejectTransfer(id: string, reason: string): Promise<TransferOrder> {
    const response = await this.client.post<TransferOrderResponse>(
      `/api/v1/inventory/transfers/${id}/reject`,
      { reason },
    );
    return response.data!;
  }

  async createCount(data: CreateCountRequest): Promise<StockMovementResponse> {
    const response = await this.client.post<StockMovementResponse>(
      "/api/v1/inventory/counts",
      data,
    );
    return response;
  }

  async applyCount(id: string): Promise<StockMovementResponse> {
    const response = await this.client.post<StockMovementResponse>(
      `/api/v1/inventory/counts/${id}/apply`,
    );
    return response;
  }
}
