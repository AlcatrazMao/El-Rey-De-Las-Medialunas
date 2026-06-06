import type { ApiClient } from "../client";
import type {
  SalesReport,
  InventoryReport,
  ProductionReport,
  CashReport,
  Analytics,
  Dashboard,
} from "../types";

export interface ReportFilters {
  branch_id?: string;
  from_date?: string;
  to_date?: string;
  period?: "daily" | "weekly" | "monthly" | "yearly";
  group_by?: string;
  format?: "json" | "csv";
}

export interface DashboardFilters {
  branch_id?: string;
  period?: "today" | "yesterday" | "this_week" | "this_month";
}

export class ReportEndpoints {
  constructor(private client: ApiClient) {}

  async getSalesReport(filters?: ReportFilters): Promise<SalesReport> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: SalesReport }>(
      "/api/v1/reports/sales",
      { params },
    );
    return response.data;
  }

  async getInventoryReport(filters?: ReportFilters): Promise<InventoryReport> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: InventoryReport }>(
      "/api/v1/reports/inventory",
      { params },
    );
    return response.data;
  }

  async getProductionReport(filters?: ReportFilters): Promise<ProductionReport> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: ProductionReport }>(
      "/api/v1/reports/production",
      { params },
    );
    return response.data;
  }

  async getCashReport(filters?: ReportFilters): Promise<CashReport> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: CashReport }>(
      "/api/v1/reports/cash",
      { params },
    );
    return response.data;
  }

  async getAnalytics(filters?: ReportFilters): Promise<Analytics> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: Analytics }>(
      "/api/v1/reports/analytics",
      { params },
    );
    return response.data;
  }

  async getDashboard(filters?: DashboardFilters): Promise<Dashboard> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: Dashboard }>(
      "/api/v1/reports/dashboard",
      { params },
    );
    return response.data;
  }
}
