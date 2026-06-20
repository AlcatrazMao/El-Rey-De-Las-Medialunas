import { app } from "./app";
import type { Env } from "./types/bindings";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<unknown>, _env: Env, ctx: ExecutionContext): Promise<void> {
    const messages = batch.messages;
    ctx.waitUntil(
      (async () => {
        for (const message of messages) {
          try {
            message.ack();
          } catch (err) {
            console.error("Queue message processing failed:", err);
            message.retry();
          }
        }
      })(),
    );
  },

  // FIX A3: cron handler para expirar lotes vencidos sin requerir intervención
  // manual. Corre con el schedule configurado en wrangler.toml (recomendado:
  // cada hora). Usa DATE('now', '-3 hours') para alinear con hora Argentina
  // (UTC-3): un lote con expiry_date = hoy queda activo hasta las 03:00 UTC
  // del día siguiente (00:00 hora ARG).
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await env.DB.prepare(
            `UPDATE inventory_batches
               SET status = 'expired'
             WHERE status = 'active'
               AND expiry_date IS NOT NULL
               AND expiry_date < DATE('now', '-3 hours')`,
          ).run();
          console.log(
            `[scheduled:${event.cron}] expired batches:`,
            result.meta.changes ?? 0,
          );
        } catch (err) {
          console.error("[scheduled] expire batches failed:", err);
        }
      })(),
    );
  },
};
