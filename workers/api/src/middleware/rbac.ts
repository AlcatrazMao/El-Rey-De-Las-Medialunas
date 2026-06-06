import { createMiddleware } from "hono/factory";
import type { PermissionAction, PermissionModule } from "@medialunas/shared";
import { hasPermission, type Role } from "@medialunas/shared";
import type { Env, Variables } from "../types/bindings";

interface RbacConfig {
  module: PermissionModule;
  action: PermissionAction;
}

export function rbacMiddleware(module: PermissionModule, action: PermissionAction) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const role = c.var.userRole;

    if (!hasPermission(role as Role, module, action)) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: `No tienes permisos para ${action} en ${module}`,
          },
        },
        403,
      );
    }

    await next();
  });
}

export function requireRole(...allowedRoles: Role[]) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const role = c.var.userRole;

    if (!allowedRoles.includes(role as Role)) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Rol no autorizado para esta operación",
          },
        },
        403,
      );
    }

    await next();
  });
}
