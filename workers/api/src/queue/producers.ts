import type { Env } from "../types/bindings";

export interface QueueMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: string;
  branch_id: string;
  user_id?: string;
}

export async function enqueueInventoryMessage(env: Env, payload: Record<string, unknown>): Promise<void> {
  const message: QueueMessage = {
    type: "inventory_update",
    payload,
    timestamp: new Date().toISOString(),
    branch_id: (payload.branch_id as string) ?? "unknown",
    user_id: payload.user_id as string | undefined,
  };

  await env.INVENTORY_QUEUE.send(message);
}

export async function enqueueReportMessage(env: Env, payload: Record<string, unknown>): Promise<void> {
  const message: QueueMessage = {
    type: "report_generation",
    payload,
    timestamp: new Date().toISOString(),
    branch_id: (payload.branch_id as string) ?? "unknown",
    user_id: payload.user_id as string | undefined,
  };

  await env.REPORTS_QUEUE.send(message);
}

export async function enqueueAuditLogMessage(env: Env, payload: {
  user_id: string;
  branch_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}): Promise<void> {
  const message: QueueMessage = {
    type: "audit_log",
    payload,
    timestamp: new Date().toISOString(),
    branch_id: payload.branch_id ?? "unknown",
    user_id: payload.user_id,
  };

  await env.INVENTORY_QUEUE.send(message);
}
