import { createMiddleware } from "hono/factory";

import type { Env, Variables } from "../types/bindings";

const AUDITABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function auditLogMiddleware() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    if (!AUDITABLE_METHODS.has(method) || path.includes("/health")) {
      await next();
      return;
    }

    const startTime = Date.now();
    const userId = c.var.userId ?? "anonymous";
    const branchId = c.var.branchId ?? "unknown";
    const xff = c.req.header("X-Forwarded-For");
    const firstHop = xff ? xff.split(",")[0]?.trim() : undefined;
    const ip = c.req.header("CF-Connecting-IP") ?? firstHop ?? "unknown";
    const userAgent = c.req.header("User-Agent") ?? "unknown";

    // SECURITY: cap audit log field lengths so a malicious client cannot
    // bloat the audit_log table with megabyte-sized User-Agent strings.
    const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

    const auditEntry: Record<string, unknown> = {
      user_id: userId,
      branch_id: branchId,
      action: truncate(`${method} ${path}`, 500),
      entity_type: extractEntityType(path),
      entity_id: extractEntityId(path),
      old_values: null,
      new_values: null,
      ip_address: truncate(ip, 64),
      user_agent: truncate(userAgent, 500),
      created_at: new Date().toISOString(),
    };

    await next();

    const duration = Date.now() - startTime;
    auditEntry.duration_ms = duration;

    c.executionCtx.waitUntil(logAuditEntry(c.env, auditEntry));
  });
}

function extractEntityType(path: string): string {
  const parts = path.split("/").filter(Boolean);
  // /api/v1/{entity}/... -> entity
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "v1") {
    return parts[2] ?? "unknown";
  }
  return parts[0] ?? "unknown";
}

// BUG FIX M1 — el regex anterior requería UUID con guiones (36 chars), pero
// `genId()` genera IDs hex de 32 chars sin guiones. Resultado: TODOS los audit
// logs quedaban con entity_id = null. Aceptamos ambos formatos.
export function extractEntityId(path: string): string | null {
  const match = path.match(/\/([a-f0-9]{32}|[a-f0-9-]{36})(?:\/|$)/);
  return match ? (match[1] ?? null) : null;
}

async function logAuditEntry(env: Env, entry: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, user_id, branch_id, action, entity_type, entity_id,
        old_values, new_values, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        (entry.user_id as string) ?? null,
        (entry.branch_id as string) ?? null,
        (entry.action as string) ?? "unknown",
        (entry.entity_type as string) ?? "unknown",
        (entry.entity_id as string) ?? null,
        entry.old_values ? JSON.stringify(entry.old_values) : null,
        entry.new_values ? JSON.stringify(entry.new_values) : null,
        (entry.ip_address as string) ?? null,
        (entry.user_agent as string) ?? null,
        entry.created_at as string,
      )
      .run();
  } catch (err) {
    console.error("Failed to write audit log entry:", err);
  }
}
