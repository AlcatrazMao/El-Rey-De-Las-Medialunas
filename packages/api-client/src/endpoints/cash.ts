import type {
  CashSession,
  CashSessionResponse,
  CashMovementsResponse,
  CashMovement,
  OpenCashSessionRequest,
  CloseCashSessionRequest,
  CashMovementRequest,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";

export interface CashSessionFilters {
  branch_id?: string;
  user_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
  /** Cursor-based pagination: trae sesiones con id < before_id. */
  before_id?: string;
}

export class CashEndpoints {
  constructor(private client: ApiClient) {}

  async openSession(data: OpenCashSessionRequest): Promise<CashSession> {
    const response = await this.client.post<CashSessionResponse>(
      "/api/v1/cash/sessions/open",
      data,
    );
    return response.data!;
  }

  async closeSession(id: string, data: CloseCashSessionRequest): Promise<CashSession> {
    const response = await this.client.post<CashSessionResponse>(
      `/api/v1/cash/sessions/${id}/close`,
      data,
    );
    return response.data!;
  }

  async getSession(id: string): Promise<CashSession> {
    const response = await this.client.get<CashSessionResponse>(
      `/api/v1/cash/sessions/${id}`,
    );
    return response.data!;
  }

  async getMovements(id: string): Promise<CashMovement[]> {
    const response = await this.client.get<CashMovementsResponse>(
      `/api/v1/cash/sessions/${id}/movements`,
    );
    return response.data!;
  }

  async addMovement(id: string, data: CashMovementRequest): Promise<CashMovement> {
    const response = await this.client.post<{ success: boolean; data: CashMovement }>(
      `/api/v1/cash/sessions/${id}/movements`,
      data,
    );
    return response.data;
  }

  async getSessions(filters?: CashSessionFilters): Promise<CashSession[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: CashSession[] }>(
      "/api/v1/cash/sessions",
      { params },
    );
    return response.data;
  }
}
