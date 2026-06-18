/**
 * Inventory Worker — Queue consumer for inventory-processing queue
 * Processes stock movements, inventory updates, batch updates, and audit logs.
 */

interface Env {
  DB: D1Database;
}

interface InventoryUpdatePayload {
  product_id: string;
  branch_id: string;
  delta: number;
  movement_type:
    | "sale_out"
    | "purchase_in"
    | "production_in"
    | "production_out"
    | "waste_out"
    | "adjustment_in"
    | "adjustment_out"
    | "return_in";
  unit_cost_at_time?: number;
  reason?: string;
  reference_type?: string;
  reference_id?: string;
  user_id?: string;
  batch_id?: string;
}

interface AuditLogPayload {
  user_id: string;
  branch_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}

interface QueueMessage {
  type: "inventory_update" | "audit_log";
  payload: Record<string, unknown>;
  timestamp: string;
  branch_id: string;
  user_id?: string;
}

async function handleInventoryUpdate(
  payload: InventoryUpdatePayload,
  db: D1Database,
): Promise<void> {
  const movementId = crypto.randomUUID();
  const inventoryId = crypto.randomUUID();

  const statements: D1PreparedStatement[] = [];

  statements.push(
    db
      .prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, batch_id, movement_type, quantity, unit_cost_at_time, reason, reference_type, reference_id, user_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`,
      )
      .bind(
        movementId,
        payload.product_id,
        payload.branch_id,
        payload.batch_id ?? null,
        payload.movement_type,
        payload.delta,
        payload.unit_cost_at_time ?? null,
        payload.reason ?? null,
        payload.reference_type ?? null,
        payload.reference_id ?? null,
        payload.user_id ?? null,
      ),
  );

  statements.push(
    db
      .prepare(
        `INSERT INTO inventory (id, product_id, branch_id, quantity, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(product_id, branch_id) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           updated_at = excluded.updated_at`,
      )
      .bind(
        inventoryId,
        payload.product_id,
        payload.branch_id,
        payload.delta,
      ),
  );

  if (payload.batch_id) {
    statements.push(
      db
        .prepare(
          `UPDATE inventory_batches
           SET remaining_quantity = MAX(0, remaining_quantity + ?),
               status = CASE WHEN remaining_quantity + ? <= 0 THEN 'sold_out' ELSE status END
           WHERE id = ?`,
        )
        .bind(payload.delta, payload.delta, payload.batch_id),
    );
  }

  await db.batch(statements);
}

async function handleAuditLog(
  payload: AuditLogPayload,
  db: D1Database,
): Promise<void> {
  const auditId = crypto.randomUUID();
  const oldValues = payload.old_values
    ? JSON.stringify(payload.old_values)
    : null;
  const newValues = payload.new_values
    ? JSON.stringify(payload.new_values)
    : null;

  await db
    .prepare(
      `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      auditId,
      payload.user_id,
      payload.action,
      payload.entity_type,
      payload.entity_id,
      oldValues,
      newValues,
      payload.ip_address ?? null,
      payload.user_agent ?? null,
    )
    .run();
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        const body = message.body;
        if (body.type === "inventory_update") {
          await handleInventoryUpdate(
            body.payload as unknown as InventoryUpdatePayload,
            env.DB,
          );
        } else if (body.type === "audit_log") {
          await handleAuditLog(
            body.payload as unknown as AuditLogPayload,
            env.DB,
          );
        }
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;
