import type { AuditEntriesResponse } from "@medialunas/shared/types/api";
import type { ApiClient } from "../client";

export interface AuditFilters {
  user_id?: string;
  branch_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export class AuditEndpoints {
  constructor(private client: ApiClient) {}

  async query(filters?: AuditFilters): Promise<AuditEntriesResponse> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    return this.client.get<AuditEntriesResponse>("/api/v1/audit", { params });
  }
}
