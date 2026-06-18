/**
 * Sync Worker — Handles offline sync push/pull operations
 * Processes client sync requests with idempotency via KV.
 */

interface Env {
  DB: D1Database;
  SYNC_STATE: KVNamespace;
}

interface SaleItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  tax_rate: number;
  tax_amount: number;
  notes?: string;
}

interface PaymentInput {
  payment_method: string;
  amount: number;
  reference?: string;
}

interface SaleData {
  id: string;
  branch_id: string;
  customer_id?: string;
  subtotal: number;
  discount_total?: number;
  tax_total: number;
  total: number;
  notes?: string;
  origin: "local";
  client_timestamp: string;
  items: SaleItemInput[];
  payments: PaymentInput[];
}

interface SyncOperation {
  client_id: string;
  entity_type: "sale";
  operation: "create";
  data: SaleData;
}

interface PushBody {
  branch_id: string;
  operations: SyncOperation[];
}

interface OperationResult {
  client_id: string;
  success: boolean;
  skipped?: boolean;
  server_id?: string;
  error?: string;
}

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const IDEMPOTENCY_TTL_SECONDS = 604800; // 7 days
const DEFAULT_SINCE = "2020-01-01T00:00:00Z";
const PULL_LIMIT = 100;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

async function processSaleOperation(
  env: Env,
  op: SyncOperation,
): Promise<OperationResult> {
  try {
    const idempotencyKey = `processed:${op.client_id}`;
    const alreadyProcessed = await env.SYNC_STATE.get(idempotencyKey);
    if (alreadyProcessed) {
      return { client_id: op.client_id, success: true, skipped: true };
    }

    const sale = op.data;

    // 1) Obtener próximo sale_number atómicamente para la sucursal
    const maxRow = await env.DB.prepare(
      "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next_number FROM sales WHERE branch_id = ?",
    )
      .bind(sale.branch_id)
      .first<{ next_number: number }>();

    const saleNumber = maxRow?.next_number ?? 1;

    // 2) Insertar sale
    await env.DB.prepare(
      `INSERT INTO sales (
        id, branch_id, customer_id, sale_number,
        subtotal, discount_total, tax_total, total,
        status, sync_status, notes, origin,
        client_timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'synced', ?, ?, ?, datetime('now'))`,
    )
      .bind(
        sale.id,
        sale.branch_id,
        sale.customer_id ?? null,
        saleNumber,
        sale.subtotal,
        sale.discount_total ?? 0,
        sale.tax_total,
        sale.total,
        sale.notes ?? null,
        sale.origin,
        sale.client_timestamp,
      )
      .run();

    // 3) Insertar items
    for (const item of sale.items) {
      const itemId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO sale_items (
          id, sale_id, product_id, quantity,
          unit_price, discount, tax_rate, tax_amount, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          itemId,
          sale.id,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.discount ?? 0,
          item.tax_rate,
          item.tax_amount,
          item.notes ?? null,
        )
        .run();
    }

    // 4) Insertar payments
    for (const payment of sale.payments) {
      const paymentId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO sale_payments (
          id, sale_id, payment_method, amount, reference
        ) VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(
          paymentId,
          sale.id,
          payment.payment_method,
          payment.amount,
          payment.reference ?? null,
        )
        .run();
    }

    // 5) Marcar idempotencia (7 días)
    await env.SYNC_STATE.put(idempotencyKey, "1", {
      expirationTtl: IDEMPOTENCY_TTL_SECONDS,
    });

    return {
      client_id: op.client_id,
      success: true,
      server_id: sale.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      client_id: op.client_id,
      success: false,
      error: message,
    };
  }
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return jsonResponse(
      { success: false, error: "Invalid JSON body" },
      400,
    );
  }

  if (!body || typeof body.branch_id !== "string" || !Array.isArray(body.operations)) {
    return jsonResponse(
      { success: false, error: "Missing branch_id or operations" },
      400,
    );
  }

  const results: OperationResult[] = [];

  for (const op of body.operations) {
    if (!op || typeof op.client_id !== "string") {
      results.push({
        client_id: op?.client_id ?? "unknown",
        success: false,
        error: "Invalid operation shape",
      });
      continue;
    }

    if (op.entity_type === "sale" && op.operation === "create") {
      const result = await processSaleOperation(env, op);
      results.push(result);
    } else {
      results.push({
        client_id: op.client_id,
        success: false,
        error: `Unsupported entity_type/operation: ${op.entity_type}/${op.operation}`,
      });
    }
  }

  return jsonResponse({ success: true, results });
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branch_id");

  if (!branchId) {
    return jsonResponse(
      { success: false, error: "branch_id is required" },
      400,
    );
  }

  const since = url.searchParams.get("since") ?? DEFAULT_SINCE;
  const entityTypesParam = url.searchParams.get("entity_types") ?? "sale,product";
  const entityTypes = entityTypesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const changes: Array<{ entity_type: string; data: unknown }> = [];

  try {
    if (entityTypes.includes("sale")) {
      const salesRes = await env.DB.prepare(
        `SELECT * FROM sales
         WHERE branch_id = ? AND created_at > ? AND origin != 'local'
         ORDER BY created_at ASC
         LIMIT ?`,
      )
        .bind(branchId, since, PULL_LIMIT)
        .all();

      for (const row of salesRes.results ?? []) {
        changes.push({ entity_type: "sale", data: row });
      }
    }

    if (entityTypes.includes("product")) {
      const productsRes = await env.DB.prepare(
        `SELECT id, name, price, code, barcode, is_active, updated_at
         FROM products
         WHERE branch_id = ? AND updated_at > ?
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
        .bind(branchId, since, PULL_LIMIT)
        .all();

      for (const row of productsRes.results ?? []) {
        changes.push({ entity_type: "product", data: row });
      }
    }

    const lastTimestamp = new Date().toISOString();
    await env.SYNC_STATE.put(`last_pull:${branchId}`, lastTimestamp);

    return jsonResponse({
      success: true,
      data: {
        changes,
        last_timestamp: lastTimestamp,
        has_more: false,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { success: false, error: `Pull failed: ${message}` },
      500,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/sync/push") {
      return handlePush(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/sync/pull") {
      return handlePull(request, env);
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({ success: true, service: "sync-worker", status: "ok" });
    }

    return jsonResponse({ success: false, error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
