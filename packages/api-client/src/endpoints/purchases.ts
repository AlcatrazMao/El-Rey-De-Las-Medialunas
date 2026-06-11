import type {
  PurchaseOrder,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";
import type { PaginatedResponse } from "../types";

export interface PurchaseOrderFilters {
  branch_id?: string;
  supplier_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

export interface CreatePurchaseOrderRequest {
  supplier_id: string;
  branch_id: string;
  expected_delivery_date?: string;
  notes?: string;
  items: {
    product_id: string;
    quantity: number;
    unit_cost: number;
    notes?: string;
  }[];
}

export interface ReceiveOrderRequest {
  items: {
    item_id: string;
    received_quantity: number;
    batch_number?: string;
    cost_per_unit?: number;
    notes?: string;
  }[];
  notes?: string;
}

export class PurchaseEndpoints {
  constructor(private client: ApiClient) {}

  async getOrders(filters?: PurchaseOrderFilters): Promise<PaginatedResponse<PurchaseOrder>> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<PaginatedResponse<PurchaseOrder>>("/api/v1/purchases/orders", {
      params,
    });
  }

  async createOrder(data: CreatePurchaseOrderRequest): Promise<PurchaseOrder> {
    const response = await this.client.post<{ success: boolean; data: PurchaseOrder }>(
      "/api/v1/purchases/orders",
      data,
    );
    return response.data;
  }

  async receiveOrder(id: string, data: ReceiveOrderRequest): Promise<PurchaseOrder> {
    const response = await this.client.post<{ success: boolean; data: PurchaseOrder }>(
      `/api/v1/purchases/orders/${id}/receive`,
      data,
    );
    return response.data;
  }
}
