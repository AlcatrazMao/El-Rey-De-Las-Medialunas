import type { Sale } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "https://el-rey-api-production.elprincipitodeargentina.workers.dev";

/**
 * Sync a sale to D1 via the API Worker.
 * Non-blocking — failures are silent (localStorage is the source of truth).
 */
export async function syncSaleToD1(sale: Sale): Promise<void> {
  const token = localStorage.getItem("firebase_token");
  if (!token) return; // No auth, skip sync

  const res = await fetch(`${API_URL}/api/v1/sales`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      client_id: sale.id,
      branch_id: "00000000000000000000000000000001", // Casa Central
      customer_id: sale.customerId || null,
      items: sale.items.map(item => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.price,
        discount: 0,
        notes: null,
      })),
      payments: [{
        payment_method: sale.paymentMethod,
        amount: sale.total,
        reference: null,
      }],
      notes: sale.customerName ? `Cliente: ${sale.customerName}` : null,
    }),
  });

  if (!res.ok) {
    console.warn("D1 sync failed:", await res.text());
  }
}

/**
 * Fetch sales from D1.
 */
export async function fetchSalesFromD1(branchId?: string, from?: string, to?: string): Promise<Sale[]> {
  const token = localStorage.getItem("firebase_token");
  if (!token) return [];

  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", branchId);
  if (from) params.set("from_date", from);
  if (to) params.set("to_date", to);
  params.set("limit", "100");

  const res = await fetch(`${API_URL}/api/v1/sales?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}
