import type { ApiError, ApiResponse } from "@medialunas/shared";
import type { ErrorHandler } from "hono";

import type { Env, Variables } from "../types/bindings";

export const errorHandler: ErrorHandler<{ Bindings: Env; Variables: Variables }> = (
  err,
  c,
) => {
  const error: ApiError = {
    code: "INTERNAL_ERROR",
    message: "Error interno del servidor",
  };

  let status = 500;

  if (err instanceof ValidationError) {
    error.code = "VALIDATION_ERROR";
    error.message = err.message;
    error.details = err.details;
    status = 422;
  } else if (err instanceof AuthenticationError) {
    error.code = "UNAUTHORIZED";
    error.message = err.message;
    status = 401;
  } else if (err instanceof ForbiddenError) {
    error.code = "FORBIDDEN";
    error.message = err.message;
    status = 403;
  } else if (err instanceof NotFoundError) {
    error.code = "NOT_FOUND";
    error.message = err.message;
    status = 404;
  } else if (err instanceof ConflictError) {
    error.code = "CONFLICT";
    error.message = err.message;
    status = 409;
  } else if (err instanceof RateLimitError) {
    error.code = "RATE_LIMITED";
    error.message = err.message;
    status = 429;
  } else {
    console.error("Unhandled error:", err);
    if (c.env?.APP_ENV === "development") {
      error.message = err.message ?? "Error interno";
      error.details = err.stack;
    }
  }

  const body: ApiResponse<never> = {
    success: false,
    error,
    meta: {
      timestamp: new Date().toISOString(),
      request_id: c.var?.requestId,
    },
  };

  return c.json(body, status as 200);
};

export class ValidationError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class AuthenticationError extends Error {
  constructor(message = "No autorizado") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Acceso denegado") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Recurso no encontrado") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message = "Conflicto") {
    super(message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends Error {
  constructor(message = "Demasiadas solicitudes") {
    super(message);
    this.name = "RateLimitError";
  }
}
