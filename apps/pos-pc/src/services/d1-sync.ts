import type { Sale } from "../types";
import { getSettings } from "../hooks/useSettings";

const API_URL = import.meta.env.VITE_API_URL || "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

function getToken(): string | null {
  return localStorage.getItem("firebase_token");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API response shape is unknown
async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (import.meta.env.DEV) console.warn(`D1 ${options.method || 'GET'} ${path} failed:`, res.status);
    return null;
  }
  try {
    return await res.json();
  } catch {
    if (import.meta.env.DEV) console.warn(`D1 ${path} returned non-JSON`);
    return null;
  }
}

// ── Sales ─────────────────────────────────────────────────────────────

export async function syncSaleToD1(sale: Sale): Promise<void> {
  await apiFetch("/api/v1/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: sale.customerId || null,
      branch_id: getSettings().business.branchId,
      customer_id: sale.customerId || null,
      items: sale.items.map(item => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.price,
        discount: 0,
        notes: null,
      })),
      payments: [{ payment_method: sale.paymentMethod, amount: sale.total, reference: null }],
      notes: sale.customerName ? `Cliente: ${sale.customerName}` : null,
    }),
  });
}

export async function fetchSalesFromD1(from?: string, to?: string): Promise<Sale[]> {
  const params = new URLSearchParams();
  if (from) params.set("from_date", from);
  if (to) params.set("to_date", to);
  params.set("limit", "100");
  params.set("sort_by", "created_at");
  params.set("sort_order", "desc");
  const data = await apiFetch(`/api/v1/sales?${params}`);
  return data?.data || [];
}

// ── Products ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1 API response shape varies
export async function fetchProductsFromD1(branchId?: string): Promise<any[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", branchId);
  params.set("limit", "200");
  const data = await apiFetch(`/api/v1/products?${params}`);
  return data?.data || [];
}

// ── Inventory ─────────────────────────────────────────────────────────

export async function syncStockMovementToD1(movement: {
  product_id: string;
  branch_id: string;
  movement_type: string;
  quantity: number;
  reason: string;
}): Promise<void> {
  await apiFetch("/api/v1/inventory/movements", {
    method: "POST",
    body: JSON.stringify({
      product_id: movement.product_id,
      branch_id: movement.branch_id || getSettings().business.branchId,
      movement_type: movement.movement_type,
      quantity: movement.quantity,
      reason: movement.reason,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1 API response shape varies
export async function fetchInventoryFromD1(branchId?: string): Promise<any[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", branchId);
  params.set("limit", "200");
  const data = await apiFetch(`/api/v1/inventory?${params}`);
  return data?.data || [];
}

// ── Customers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- customer data from localStorage may be incomplete
export async function syncCustomerToD1(customer: any): Promise<void> {
  await apiFetch("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      tax_id: customer.tax_id,
      type: customer.type,
      condicion_fiscal: customer.condicion_fiscal,
      credit_limit: customer.credit_limit,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1 API response shape varies
export async function fetchCustomersFromD1(): Promise<any[]> {
  const data = await apiFetch("/api/v1/customers?limit=200");
  return data?.data || [];
}

// ── Cash ──────────────────────────────────────────────────────────────

export async function syncCashSessionToD1(session: {
  id: string;
  branch_id: string;
  opening_amount: number;
  closing_amount?: number;
  status: string;
  opened_at: string;
  closed_at?: string;
  notes?: string;
}): Promise<void> {
  if (session.status === "open") {
    await apiFetch("/api/v1/cash/sessions/open", {
      method: "POST",
      body: JSON.stringify({
        id: session.id,
        branch_id: session.branch_id,
        opening_amount: session.opening_amount,
        notes: session.notes ?? null,
      }),
    });
  }
}

export async function syncCashSessionCloseToD1(
  sessionId: string,
  closingAmount: number,
  expectedAmount: number,
  notes?: string
): Promise<void> {
  await apiFetch(`/api/v1/cash/sessions/${sessionId}/close`, {
    method: "POST",
    body: JSON.stringify({
      closing_amount: closingAmount,
      expected_amount: expectedAmount,
      notes: notes ?? null,
    }),
  });
}

// ── Supply Requests ───────────────────────────────────────────────────

export async function syncSupplyRequestToD1(req: {
  id: string;
  type: 'ingredient' | 'product';
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  requestedBy: string;
}): Promise<void> {
  await apiFetch("/api/v1/supply-requests", {
    method: "POST",
    body: JSON.stringify({
      id: req.id,
      type: req.type,
      item_id: req.itemId,
      item_name: req.itemName,
      quantity: req.quantity,
      unit: req.unit,
      reason: req.reason,
      requested_by: req.requestedBy,
      branch_id: getSettings().business.branchId,
    }),
  });
}

export async function updateSupplyRequestStatusInD1(
  id: string,
  status: 'approved' | 'rejected',
  adminMemo?: string
): Promise<void> {
  await apiFetch(`/api/v1/supply-requests/${id}`, {
    method: "PUT",
    body: JSON.stringify({ status, admin_memo: adminMemo ?? null }),
  });
}

// ── User Preferences ──────────────────────────────────────────────────

export async function syncUserPreferencesToD1(customPanels: string[]): Promise<void> {
  await apiFetch("/api/v1/auth/preferences", {
    method: "PUT",
    body: JSON.stringify({ custom_panels: customPanels }),
  });
}

// ── Sales Void ────────────────────────────────────────────────────────

export async function syncVoidSaleToD1(saleId: string, voidReason?: string): Promise<void> {
  await apiFetch(`/api/v1/sales/${saleId}/void`, {
    method: "POST",
    body: JSON.stringify({ void_reason: voidReason ?? null }),
  });
}

// ── Expenses ──────────────────────────────────────────────────────────

export async function syncExpenseToD1(expense: {
  id: string;
  concept: string;
  category: string;
  amount: number;
  paymentMethod: string;
  invoiceUrl?: string;
}): Promise<void> {
  await apiFetch("/api/v1/expenses", {
    method: "POST",
    body: JSON.stringify({
      id: expense.id,
      concept: expense.concept,
      category: expense.category,
      amount: expense.amount,
      payment_method: expense.paymentMethod,
      invoice_url: expense.invoiceUrl ?? null,
      branch_id: getSettings().business.branchId,
    }),
  });
}
