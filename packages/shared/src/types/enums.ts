export type Role = "owner" | "admin" | "supervisor" | "cashier" | "production" | "warehouse";

export type MovementType =
  | "purchase_in"
  | "production_in"
  | "transfer_in"
  | "adjustment_in"
  | "return_in"
  | "sale_out"
  | "transfer_out"
  | "waste_out"
  | "adjustment_out"
  | "production_out";

export type PaymentMethod = "cash" | "credit_card" | "debit_card" | "transfer" | "digital_wallet";

export type PriceListType = "retail" | "wholesale" | "promotional";

export type OrderStatus = "completed" | "voided" | "refunded";

export type TransferStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "in_transit"
  | "received"
  | "completed";

export type UnitType = "unit" | "kg" | "g" | "l" | "ml" | "dozen" | "pack";

export type CustomerType = "consumer" | "frequent" | "wholesale" | "corporate";

export type SyncStatus = "pending" | "synced" | "failed" | "conflict";

export type SyncOperation = "create" | "update" | "delete";

export type CashSessionStatus = "open" | "closing" | "closed";

export type CashMovementType = "sale" | "expense" | "income" | "withdrawal";

export type ProductionBatchStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

export type InventoryMethod = "FIFO" | "LIFO";

export type DocumentType = "dni" | "cuit" | "cuil" | "passport";
