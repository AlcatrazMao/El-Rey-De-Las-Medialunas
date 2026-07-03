import type { Role } from "../types/enums";

export type PermissionAction = "read" | "create" | "update" | "delete";

export type PermissionModule =
  | "sales"
  | "products"
  | "categories"
  | "inventory"
  | "cash"
  | "customers"
  | "production"
  | "purchases"
  | "transfers"
  | "reports"
  | "audit"
  | "users"
  | "branches"
  | "sync"
  | "settings";

type PermissionMatrix = Record<Role, Record<PermissionModule, PermissionAction[]>>;

export const PERMISSIONS: PermissionMatrix = {
  owner: {
    sales: ["read", "create", "update", "delete"],
    products: ["read", "create", "update", "delete"],
    categories: ["read", "create", "update", "delete"],
    inventory: ["read", "create", "update", "delete"],
    cash: ["read", "create", "update", "delete"],
    customers: ["read", "create", "update", "delete"],
    production: ["read", "create", "update", "delete"],
    purchases: ["read", "create", "update", "delete"],
    transfers: ["read", "create", "update", "delete"],
    reports: ["read", "create", "update", "delete"],
    audit: ["read", "create", "update", "delete"],
    users: ["read", "create", "update", "delete"],
    branches: ["read", "create", "update", "delete"],
    sync: ["read", "create", "update", "delete"],
    settings: ["read", "create", "update", "delete"],
  },
  admin: {
    sales: ["read", "create", "update", "delete"],
    products: ["read", "create", "update", "delete"],
    categories: ["read", "create", "update", "delete"],
    inventory: ["read", "create", "update", "delete"],
    cash: ["read", "create", "update", "delete"],
    customers: ["read", "create", "update", "delete"],
    production: ["read", "create", "update", "delete"],
    purchases: ["read", "create", "update", "delete"],
    transfers: ["read", "create", "update", "delete"],
    reports: ["read", "create", "update", "delete"],
    // NOTE: audit y users se mantienen restringidos aposta — admin no debe
    // poder borrar el rastro de auditoría ni eliminar usuarios (solo owner).
    audit: ["read"],
    users: ["read", "create", "update"],
    branches: ["read", "create", "update", "delete"],
    sync: ["read", "create", "update", "delete"],
    settings: ["read", "create", "update", "delete"],
  },
  supervisor: {
    sales: ["read", "create", "update"],
    products: ["read"],
    categories: ["read"],
    inventory: ["read", "create", "update"],
    cash: ["read", "create", "update"],
    customers: ["read", "create", "update"],
    production: ["read", "create", "update"],
    purchases: ["read"],
    transfers: ["read", "create"],
    reports: ["read"],
    audit: ["read"],
    users: ["read"],
    branches: ["read"],
    sync: ["read"],
    settings: [],
  },
  cashier: {
    sales: ["read", "create"],
    products: ["read"],
    categories: ["read"],
    inventory: ["read"],
    cash: ["read", "create"],
    customers: ["read", "create"],
    production: [],
    purchases: [],
    transfers: [],
    reports: [],
    audit: [],
    users: [],
    branches: ["read"],
    sync: [],
    settings: [],
  },
  production: {
    sales: [],
    products: ["read"],
    categories: ["read"],
    inventory: ["read", "create"],
    cash: [],
    customers: [],
    production: ["read", "create", "update"],
    purchases: [],
    transfers: [],
    reports: [],
    audit: [],
    users: [],
    branches: ["read"],
    sync: [],
    settings: [],
  },
  warehouse: {
    sales: [],
    products: ["read"],
    categories: ["read"],
    inventory: ["read", "create", "update"],
    cash: [],
    customers: [],
    production: ["read"],
    purchases: ["read", "create"],
    transfers: ["read", "create"],
    reports: [],
    audit: [],
    users: [],
    branches: ["read"],
    sync: [],
    settings: [],
  },
};

export function hasPermission(
  role: Role,
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  return PERMISSIONS[role]?.[module]?.includes(action) ?? false;
}

export function getModulePermissions(
  role: Role,
  module: PermissionModule,
): PermissionAction[] {
  return PERMISSIONS[role]?.[module] ?? [];
}

export function getRolePermissions(role: Role): Record<PermissionModule, PermissionAction[]> {
  return PERMISSIONS[role];
}
