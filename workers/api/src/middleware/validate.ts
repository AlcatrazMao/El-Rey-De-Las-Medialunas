import { createMiddleware } from "hono/factory";
import type { ZodSchema } from "zod";
import type { Env, Variables } from "../types/bindings";

interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidationTarget) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    if (schemas.body) {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: "BAD_REQUEST", message: "Cuerpo de solicitud inválido" },
          },
          400,
        );
      }

      const result = schemas.body.safeParse(body);
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Datos inválidos",
              details: result.error.flatten().fieldErrors,
            },
          },
          422,
        );
      }

      c.set("validatedBody", result.data);
    }

    if (schemas.query) {
      const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
      const result = schemas.query.safeParse(query);
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Parámetros de consulta inválidos",
              details: result.error.flatten().fieldErrors,
            },
          },
          422,
        );
      }
      c.set("validatedQuery", result.data);
    }

    if (schemas.params) {
      const params = c.req.param();
      const result = schemas.params.safeParse(params);
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Parámetros de ruta inválidos",
              details: result.error.flatten().fieldErrors,
            },
          },
          422,
        );
      }
      c.set("validatedParams", result.data);
    }

    await next();
  });
}
