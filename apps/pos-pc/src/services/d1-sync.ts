import { getSettings } from "../hooks/useSettings";
import { syncErrorStore } from "../lib/idb";
import type { Sale, Product, CategoryType, CashSession as LocalCashSession, SyncErrorCategory } from "../types";

import { getApi } from "./api";
import { dbAdapter } from "./db-adapter";

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|failed/i.test((err as TypeError).message);
}

// ── Backoff & classification (sync-error-console) ────────────────────────
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 300_000;

/**
 * Próximo timestamp ISO en el que se debe reintentar.
 * delay = min(BASE * 2^attempts + jitter, MAX). El jitter (0–1000 ms) evita
 * "thundering herd" cuando el server vuelve online y N clientes reintentan
 * simultáneamente.
 */
export function calcNextRetry(attempts: number): string {
  const jitter = Math.floor(Math.random() * 1_000);
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts) + jitter, BACKOFF_MAX_MS);
  return new Date(Date.now() + delay).toISOString();
}

/**
 * Clasifica un error de sync en una de las 4 categorías.
 *   - network: offline / fetch TypeError → reintentable automáticamente
 *   - auth: 401/403 → requiere refresh de token + reintento
 *   - validation: 400/422 → payload inválido, requiere edición manual
 *   - server: cualquier otra cosa → reintentable con cautela
 */
export function classifyError(err: unknown, response?: Response): SyncErrorCategory {
  if (!navigator.onLine || (err instanceof TypeError && /fetch|network|failed/i.test((err as Error).message))) {
    return 'network';
  }
  if (response?.status === 401 || response?.status === 403) return 'auth';
  if (response?.status === 400 || response?.status === 422) return 'validation';
  return 'server';
}

/**
 * Persiste un fallo de sync en IndexedDB. Si ya existe un registro pendiente
 * para esta venta (mismo sale_id, resolved_at=null), lo deja como está — no
 * duplicamos. El motor de retries se encarga de actualizarlo.
 */
export async function persistSyncError(params: {
  saleId: string;
  category: SyncErrorCategory;
  message: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const existing = await syncErrorStore.findBySaleId(params.saleId);
  if (existing) {
    // Ya hay un registro abierto para esta venta. No duplicamos; el scheduler
    // del useSyncEngine va a empujar el reintento.
    return;
  }
  await syncErrorStore.add({
    sale_id: params.saleId,
    category: params.category,
    message: params.message,
    payload: JSON.stringify(params.payload),
    attempts: 0,
    next_retry_at: calcNextRetry(0),
    created_at: new Date().toISOString(),
    resolved_at: null,
    status: 'pending',
  });
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

/**
 * Construye el payload canónico para POST /sales.
 *
 * Source of truth = el frontend. Los 3 campos contables que mandamos al backend:
 *   - subtotal_bruto: suma(unit_price × quantity) sin descuentos
 *   - discount_total: subtotal_bruto − total_final (siempre derivado)
 *   - total_final:    lo que efectivamente se cobra al cliente
 *
 * Además mandamos `idempotency_key` para que el backend deduplique reintentos.
 */
export function buildSalePayload(sale: Sale, ivaRate: number): Record<string, unknown> {
  const branchId = getSettings().business.branchId;
  return {
    id: sale.id,
    client_id: sale.id,
    idempotency_key: sale.idempotencyKey,
    branch_id: branchId,
    customer_id: sale.customerId ?? null,
    // Los 3 campos canónicos
    subtotal_bruto: sale.subtotal_bruto,
    discount_total: sale.discount_total,
    total_final: sale.total_final,
    // Legacy/compat — el backend los acepta pero prefiere los canónicos
    subtotal: sale.subtotal_bruto,
    tax_total: sale.tax,
    total: sale.total_final,
    items: sale.items.map(item => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.price,
      discount: 0,
      tax_rate: ivaRate,
      tax_amount: parseFloat((item.subtotal - item.subtotal / (1 + ivaRate)).toFixed(2)),
      notes: null,
    })),
    payments: [{ payment_method: sale.paymentMethod, amount: sale.total_final, reference: null }],
    notes: sale.customerName ? `Cliente: ${sale.customerName}` : null,
    client_timestamp: sale.date,
  };
}

export async function syncSaleToD1(sale: Sale): Promise<void> {
  const ivaRate = getSettings().fiscal.ivaRate;
  const payload = buildSalePayload(sale, ivaRate);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload super-set del tipo CreateSaleRequest oficial
    await getApi().sales.create(payload as any);
  } catch (err) {
    // Extraemos response del error si el api-client lo expone (típicamente
    // como propiedad `response` en HttpError-like).
    const maybeResponse =
      err && typeof err === "object" && "response" in (err as Record<string, unknown>)
        ? ((err as { response?: Response }).response)
        : undefined;
    const category = classifyError(err, maybeResponse);
    const message = err instanceof Error ? err.message : String(err);

    // Persistimos el error para que la consola admin lo vea y el scheduler
    // de retries lo procese (network → auto-retry; validation/auth → manual).
    await persistSyncError({
      saleId: sale.id,
      category,
      message,
      payload,
    });

    if (category === "network") {
      // Compat: seguimos encolando en sales_queue para que el SyncEngine
      // legacy también lo retome al volver online. El idempotency_key del
      // backend deduplica si ambos paths terminan empujando.
      await enqueue("sale", payload);
      return;
    }
    throw err;
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


// ── Batches ───────────────────────────────────────────────────────────

/**
 * Sincroniza un lote de inventario al backend (POST /api/v2/batches).
 * Llamada fire-and-forget: si falla red/server el POS no debe romperse.
 */
export async function syncBatchToD1(batch: {
  product_id: string;
  branch_id: string;
  batch_number: string;
  entry_date: string;      // YYYY-MM-DD
  expiry_date?: string;    // YYYY-MM-DD
  cost_per_unit: number;
  initial_quantity: number;
  notes?: string;
}): Promise<void> {
  await getApi().client.post('/api/v2/batches', batch);
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

export async function fetchCashSessionsFromD1(
  limit = 30,
  beforeId?: string,
): Promise<LocalCashSession[]> {
  try {
    // Traemos todas las sesiones (abiertas y cerradas) para que las sesiones
    // abiertas de días anteriores aparezcan en el historial y puedan cerrarse manualmente.
    // Cursor-based pagination via before_id (más robusto que offset: una sesión
    // insertada mientras paginás no desplaza la ventana ni te hace saltar registros).
    const filters: { limit: number; before_id?: string } = { limit };
    if (beforeId) filters.before_id = beforeId;
    const sessions = await getApi().cash.getSessions(filters);
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

  // D1 es source of truth — descartamos productos que ya no existen en el server
  const d1Ids = new Set(d1Products.map(p => String(p.id ?? '')));
  return merged.filter(p => d1Ids.has(p.id));
}
