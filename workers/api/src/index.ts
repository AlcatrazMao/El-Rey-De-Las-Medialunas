import type { Env } from "./types/bindings";
import { app } from "./app";

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
            console.log("Processing queue message:", message.body);
            message.ack();
          } catch (err) {
            console.error("Queue message processing failed:", err);
            message.retry();
          }
        }
      })(),
    );
  },
};
