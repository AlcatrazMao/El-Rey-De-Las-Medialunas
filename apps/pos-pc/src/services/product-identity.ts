import { safeParseLocalStorage, safeSetItem } from '../utils/safeStorage';

// Only establish aliases from an exact SKU match in the same branch. Never
// infer identities from a product name (different products can share a name).
const key = (branchId: string) => `pan_erp_product_ids_${branchId}`;
export function rememberProductIdentity(branchId: string, localId: string, serverId: string): void {
  const aliases = safeParseLocalStorage<Record<string, string>>(key(branchId), {});
  aliases[localId] = serverId;
  safeSetItem(key(branchId), JSON.stringify(aliases));
}
export function canonicalProductId(branchId: string, id: string): string {
  return safeParseLocalStorage<Record<string, string>>(key(branchId), {})[id] ?? id;
}
export function reconcileSaleProductIds<T extends { branch_id?: unknown; items?: unknown }>(payload: T): T {
  if (typeof payload.branch_id !== 'string' || !Array.isArray(payload.items)) return payload;
  const branchId = payload.branch_id;
  return { ...payload, items: payload.items.map((item: Record<string, unknown>) => ({
    ...item, product_id: canonicalProductId(branchId, String(item.product_id ?? '')),
  })) };
}
