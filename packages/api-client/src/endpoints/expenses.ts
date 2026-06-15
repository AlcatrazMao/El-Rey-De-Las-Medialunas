import type { ApiClient } from "../client";

export interface Expense {
  id: string;
  branch_id: string;
  user_id: string;
  concept: string;
  category: string;
  amount: number;
  payment_method: string;
  invoice_url?: string | null;
  created_at: string;
}

export interface CreateExpenseRequest {
  id?: string;
  concept: string;
  category: string;
  amount: number;
  payment_method: string;
  invoice_url?: string | null;
  branch_id?: string;
}

export interface ExpenseFilters {
  branch_id?: string;
  category?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

export class ExpenseEndpoints {
  constructor(private client: ApiClient) {}

  async getAll(filters?: ExpenseFilters): Promise<Expense[]> {
    const params = filters as Record<string, string | number | boolean | undefined>;
    const response = await this.client.get<{ success: boolean; data: Expense[] }>(
      "/api/v1/expenses",
      { params },
    );
    return response.data;
  }

  async getById(id: string): Promise<Expense> {
    const response = await this.client.get<{ success: boolean; data: Expense }>(
      `/api/v1/expenses/${id}`,
    );
    return response.data;
  }

  async create(data: CreateExpenseRequest): Promise<{ id: string; already_existed?: boolean }> {
    const response = await this.client.post<{ success: boolean; data: { id: string; already_existed?: boolean } }>(
      "/api/v1/expenses",
      data,
    );
    return response.data;
  }
}
