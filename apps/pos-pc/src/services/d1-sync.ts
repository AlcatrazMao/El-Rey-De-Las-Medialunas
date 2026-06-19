import { getSettings } from "../hooks/useSettings";
import type { Sale, Product, CategoryType, CashSession as LocalCashSession } from "../types";

import { getApi } from "./api";
import { dbAdapter } from "./db-adapter";

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|failed/i.test((err as TypeError).message);
}

async function enqueue(entity_type: string, data: Record<string, unknown>): Promise<void> {
  const client_id = String(data.id ?? crypto.randomUUID());
  await dbAdapter.syncQueue.add({
    client_id,
    entity_type,
    operation: "create",
    version: 1,
    client_timestamp: new Date().toISOString(),
    data,
  });
}

// ── Sales ─────────────────────────────────────────────────────────────

export async function syncSaleToD1(sale: Sale): Promise<void> {
  const ivaRate = getSettings().fiscal.ivaRate;
  const subtotal = sale.total;
  const taxTotal = sale.tax;
  const total = parseFloat((subtotal + taxTotal).toFixed(2));
  const branchId = getSettings().business.branchId;

  const payload = {
    id: sale.id,
    branch_id: branchId,
    customer_id: sale.customerId ?? null,
    subtotal,
    tax_total: taxTotal,
    total,
    items: sale.items.map(item => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.price,
      discount: 0,
      tax_rate: ivaRate,
      tax_amount: parseFloat((item.subtotal * ivaRate).toFixed(2)),
      notes: null,
    })),
    payments: [{ payment_method: sale.paymentMethod, amount: total, reference: null }],
    notes: sale.customerName ? `Cliente: ${sale.customerName}` : null,
  };

  try {
    await getApi().sales.create(payload);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue("sale", payload as Record<string, unknown>);
    } else {
      throw err;
    }
  }
}

export async function fetchSalesFromD1(from?: string, to?: string): Promise<Sale[]> {
  const filters: Record<string, string | number | boolean | undefined> = {
    limit: 100,
    sort_by: "created_at",
    sort_order: "desc",
  };
  if (from) filters.from_date = from;
  if (to) filters.to_date = to;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- API Sale may differ from local Sale shape
  const response = await getApi().sales.getAll(filters as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coerce server shape to local type
  return (response.data ?? []) as any[];
}

export async function syncVoidSaleToD1(saleId: string, voidReason?: string): Promise<void> {
  try {
    await getApi().sales.voidSale(saleId, voidReason ?? "");
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue("void_sale", { id: saleId, void_reason: voidReason ?? "" });
    } else {
      throw err;
    }
  }
}


// ── Inventory ─────────────────────────────────────────────────────────

export async function syncStockMovementToD1(movement: {
  product_id: string;
  branch_id: string;
  movement_type: string;
  quantity: number;
  reason: string;
}): Promise<void> {
  try {
    await getApi().inventory.createMovement({
      product_id: movement.product_id,
      branch_id: movement.branch_id || getSettings().business.branchId,
      movement_type: movement.movement_type,
      quantity: movement.quantity,
      reason: movement.reason,
    });
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue('stock_movement', movement as Record<string, unknown>);
    } else {
      throw err;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1 inventory shape may not match local type
export async function fetchInventoryFromD1(branchId?: string): Promise<any[]> {
  const response = await getApi().inventory.getAll(
    branchId ? { branch_id: branchId, limit: 200 } : { limit: 200 },
  );
  return response.data ?? [];
}

// ── Customers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- customer from localStorage may be partially typed
export async function syncCustomerToD1(customer: any): Promise<void> {
  await getApi().customers.create({
    name: customer.name,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    type: customer.type ?? "consumer",
    credit_limit: customer.credit_limit ?? 0,
    current_debt: 0,
    is_active: true,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- coerce server shape to local type
export async function fetchCustomersFromD1(): Promise<any[]> {
  const response = await getApi().customers.getAll({ limit: 50 });
  return response.data ?? [];
}

// ── Cash ──────────────────────────────────────────────────────────────

export async function syncCashSessionToD1(session: {
  id: string;
  branch_id: string;
  opening_amount: number;
  status: string;
  notes?: string;
}): Promise<void> {
  if (session.status !== "open") return;
  const payload = {
    id: session.id,
    branch_id: session.branch_id,
    opening_amount: session.opening_amount,
    notes: session.notes ?? null,
  };
  try {
    await getApi().cash.openSession(payload);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue("cash_session", payload as Record<string, unknown>);
    } else {
      throw err;
    }
  }
}

export async function syncCashSessionCloseToD1(
  sessionId: string,
  closingAmount: number,
  expectedAmount: number,
  notes?: string,
): Promise<void> {
  try {
    await getApi().cash.closeSession(sessionId, {
      closing_amount: closingAmount,
      expected_amount: expectedAmount,
      notes: notes ?? null,
    });
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue("close_session", {
        id: sessionId,
        closing_amount: closingAmount,
        expected_amount: expectedAmount,
        notes: notes ?? null,
      });
    } else {
      throw err;
    }
  }
}

export async function fetchCashSessionsFromD1(limit = 30, offset = 0): Promise<LocalCashSession[]> {
  try {
    const sessions = await getApi().cash.getSessions({ status: 'closed', limit, offset });
    return (sessions ?? []).map((s): LocalCashSession => ({
      id: s.id,
      openedAt: s.opened_at,
      closedAt: s.closed_at ?? undefined,
      openedBy: s.user_id,
      initialAmount: s.opening_amount,
      expectedAmount: s.expected_amount ?? s.opening_amount,
      realAmount: s.closing_amount ?? undefined,
      discrepancy: s.difference ?? undefined,
      note: s.notes ?? '',
      status: s.status === 'closed' ? 'closed' : 'open',
    }));
  } catch {
    return [];
  }
}

// ── Supply Requests ───────────────────────────────────────────────────

export async function syncSupplyRequestToD1(req: {
  id: string;
  type: "ingredient" | "product";
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  requestedBy: string;
}): Promise<void> {
  const payload = {
    id: req.id,
    type: req.type,
    item_id: req.itemId,
    item_name: req.itemName,
    quantity: req.quantity,
    unit: req.unit,
    reason: req.reason,
    requested_by: req.requestedBy,
    branch_id: getSettings().business.branchId,
  };
  try {
    await getApi().supplyRequests.create(payload);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue("supply_request", payload);
    } else {
      throw err;
    }
  }
}

export async function updateSupplyRequestStatusInD1(
  id: string,
  status: "approved" | "rejected",
  adminMemo?: string,
): Promise<void> {
  await getApi().supplyRequests.updateStatus(id, {
    status,
    admin_memo: adminMemo ?? null,
  });
}

// ── User Preferences ──────────────────────────────────────────────────

export async function syncUserPreferencesToD1(customPanels: string[]): Promise<void> {
  await getApi().auth.updatePreferences(customPanels);
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
  const payload = {
    id: expense.id,
    concept: expense.concept,
    category: expense.category,
    amount: expense.amount,
    payment_method: expense.paymentMethod,
    invoice_url: expense.invoiceUrl ?? null,
    branch_id: getSettings().business.branchId,
  };
  try {
    await getApi().expenses.create(payload);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue("expense", payload);
    } else {
      throw err;
    }
  }
}

// ── Products (pull from D1 → merge into local state) ─────────────────

export async function syncProductToD1(product: {
  id: string;
  name: string;
  code: string;
  price: number;
  cost: number;
  minStock: number;
  category: string;
}): Promise<void> {
  const branchId = getSettings().business.branchId;
  const ivaRate = getSettings().fiscal.ivaRate;

  let category_id = '';
  try {
    const categories = await getApi().categories.getAll(branchId, undefined, true);
    const cats = (Array.isArray(categories) ? categories : []) as Array<{ id: unknown; name: unknown }>;
    const match = cats.find(c => String(c.name ?? '').toLowerCase() === product.category.toLowerCase());
    if (match) category_id = String(match.id ?? '');
  } catch {
    // silently skip category resolution
  }

  if (!category_id) return;

  const payload = {
    code: product.code,
    name: product.name,
    branch_id: branchId,
    category_id,
    unit: 'unit' as const,
    price: product.price,
    cost: product.cost,
    tax_rate: ivaRate,
    min_stock: product.minStock,
    max_stock: product.minStock * 10,
    track_inventory: true,
    is_producible: true,
    is_raw_material: false,
    is_active: true,
  };

  try {
    await getApi().products.create(payload);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue('product', { id: product.id, ...payload });
    }
  }
}

const VALID_CATEGORIES = new Set<CategoryType>(['panes', 'facturas', 'pasteleria', 'bebidas', 'salados']);

function normalizeCategoryName(name: string | undefined | null): CategoryType {
  const lower = (name ?? "").toLowerCase();
  if (VALID_CATEGORIES.has(lower as CategoryType)) return lower as CategoryType;
  if (lower.includes("pan")) return "panes";
  if (lower.includes("factor") || lower.includes("medialuna")) return "facturas";
  if (lower.includes("pastel") || lower.includes("torta")) return "pasteleria";
  if (lower.includes("bebida") || lower.includes("cafe")) return "bebidas";
  if (lower.includes("salad") || lower.includes("sandw")) return "salados";
  return "panes";
}

export async function fetchProductsFromD1(
  existing: Product[],
  branchId?: string,
): Promise<Product[]> {
  const [productsRes, categoriesRes] = await Promise.all([
    getApi().products.getAll(branchId ? { branch_id: branchId, limit: 200 } : { limit: 200 }),
    getApi().categories.getAll(branchId, undefined, true),
  ]);

  const d1Products = (productsRes.data ?? []) as unknown as Record<string, unknown>[];
  const d1Categories = (Array.isArray(categoriesRes) ? categoriesRes : []) as unknown as Record<string, unknown>[];

  const categoryNameById = new Map<string, string>(
    d1Categories.map(c => [String(c.id ?? ""), String(c.name ?? "")])
  );

  const existingById = new Map<string, Product>(existing.map(p => [p.id, p]));
  const merged: Product[] = [...existing];
  const seenIds = new Set<string>(existing.map(p => p.id));

  for (const d1 of d1Products) {
    const id = String(d1.id ?? "");
    if (!id) continue;

    const categoryName = categoryNameById.get(String(d1.category_id ?? ""));
    const category = normalizeCategoryName(categoryName);

    if (existingById.has(id)) {
      const local = existingById.get(id)!;
      const idx = merged.findIndex(p => p.id === id);
      merged[idx] = {
        ...local,
        name: String(d1.name ?? local.name),
        price: Number(d1.price ?? local.price),
        cost: Number(d1.cost ?? local.cost),
        minStock: Number(d1.min_stock ?? local.minStock),
        code: String(d1.code ?? local.code),
        category,
      };
    } else if (!seenIds.has(id)) {
      seenIds.add(id);
      merged.push({
        id,
        name: String(d1.name ?? ""),
        category,
        price: Number(d1.price ?? 0),
        cost: Number(d1.cost ?? 0),
        stock: 0,
        minStock: Number(d1.min_stock ?? 5),
        image: "🥐",
        code: String(d1.code ?? ""),
        ingredients: [],
      });
    }
  }

  return merged;
}
