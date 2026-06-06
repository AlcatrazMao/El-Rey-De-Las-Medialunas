import type { ConflictStrategy } from "./types";

interface ConflictRule {
  entityType: string;
  operation?: "create" | "update" | "delete";
  strategy: ConflictStrategy;
  mergeFields?: string[];
}

const CONFLICT_RULES: ConflictRule[] = [
  { entityType: "inventory", strategy: "server_wins" },
  { entityType: "inventory_batch", strategy: "server_wins" },
  { entityType: "stock_movement", strategy: "server_wins" },
  { entityType: "categories", strategy: "server_wins" },
  { entityType: "cash_sessions", strategy: "server_wins" },
  { entityType: "cash_movement", strategy: "server_wins" },
  { entityType: "purchase_order", strategy: "server_wins" },
  { entityType: "transfer_order", strategy: "server_wins" },
  { entityType: "sales", operation: "create", strategy: "client_wins" },
  { entityType: "sales", operation: "update", strategy: "server_wins" },
  { entityType: "sales", operation: "delete", strategy: "server_wins" },
  { entityType: "held_carts", strategy: "client_wins" },
  {
    entityType: "products",
    strategy: "merge",
    mergeFields: ["name", "description", "image_url", "thumbnail_url", "price", "tax_rate"],
  },
  {
    entityType: "customers",
    strategy: "merge",
    mergeFields: ["name", "email", "phone", "document_type", "document_number", "type", "notes"],
  },
  {
    entityType: "suppliers",
    strategy: "merge",
    mergeFields: ["name", "contact_name", "email", "phone", "address", "tax_id", "payment_terms", "notes"],
  },
];

export function resolveConflict(
  entityType: string,
  clientData: Record<string, unknown>,
  serverData: Record<string, unknown>,
  operation?: "create" | "update" | "delete",
): { strategy: ConflictStrategy; resolved?: Record<string, unknown>; fields?: string[] } {
  const rule = CONFLICT_RULES.find(
    (r) =>
      r.entityType === entityType &&
      (r.operation === undefined || r.operation === operation),
  );

  if (!rule) {
    return { strategy: "server_wins", resolved: serverData };
  }

  switch (rule.strategy) {
    case "server_wins":
      return { strategy: "server_wins", resolved: serverData };

    case "client_wins":
      return { strategy: "client_wins", resolved: clientData };

    case "merge": {
      if (!rule.mergeFields) {
        return { strategy: "server_wins", resolved: serverData };
      }

      const resolved = { ...serverData };

      for (const field of rule.mergeFields) {
        if (clientData[field] !== undefined && clientData[field] !== serverData[field]) {
          resolved[field] = clientData[field];
        }
      }

      return { strategy: "merge", resolved, fields: rule.mergeFields };
    }

    default:
      return { strategy: "manual" };
  }
}

export function getConflictStrategy(
  entityType: string,
  operation?: "create" | "update" | "delete",
): ConflictStrategy {
  const rule = CONFLICT_RULES.find(
    (r) =>
      r.entityType === entityType &&
      (r.operation === undefined || r.operation === operation),
  );
  return rule?.strategy ?? "server_wins";
}
