import type { Role } from "../types/enums";

export const ROLES = {
  OWNER: "owner" as Role,
  ADMIN: "admin" as Role,
  SUPERVISOR: "supervisor" as Role,
  CASHIER: "cashier" as Role,
  PRODUCTION: "production" as Role,
  WAREHOUSE: "warehouse" as Role,
} as const;

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dueño",
  admin: "Administrador",
  supervisor: "Supervisor",
  cashier: "Cajero",
  production: "Producción",
  warehouse: "Depósito",
};

export const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 6,
  admin: 5,
  supervisor: 4,
  cashier: 3,
  production: 2,
  warehouse: 1,
};

export function canManageRole(userRole: Role | undefined, targetRole: Role): boolean {
  if (!userRole) return false;
  return ROLE_HIERARCHY[userRole] > ROLE_HIERARCHY[targetRole];
}

export function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY[role];
}

export function isManagerRole(role: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.supervisor;
}
