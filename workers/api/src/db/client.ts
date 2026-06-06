import type { Env, Variables } from "../types/bindings";

export interface D1Client {
  db: D1Database;

  prepare(query: string): D1PreparedStatement;

  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>;

  exec(query: string): Promise<D1Result<unknown>>;
}

export function createD1Client(env: Env): D1Client {
  return {
    db: env.DB,

    prepare(query: string): D1PreparedStatement {
      return env.DB.prepare(query);
    },

    async batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]> {
      return env.DB.batch(statements);
    },

    async exec(query: string): Promise<D1Result<unknown>> {
      return env.DB.prepare(query).run();
    },
  };
}

export function getD1Client(c: { env: Env }): D1Client {
  return createD1Client(c.env);
}
