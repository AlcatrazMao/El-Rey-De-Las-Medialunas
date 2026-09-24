import type { ApiClientInterface } from '@medialunas/sync-engine';

import { getApi } from './api';
import type { SalePayload } from './d1-sync';
import { reconcileSaleProductIds } from './product-identity';
import { confirmLocalSale } from './sale-confirmation';

/** Drain existing Dexie sales through the SAME endpoint as online checkout.
 * Catalog dependencies go first; a failed operation stays in the original queue.
 */
export const pushLegacyOperations: ApiClientInterface['sync']['push'] = async (operations, branchId) => {
  const catalog = operations.filter(op => op.entity_type === 'product');
  const ordered = [...catalog, ...operations.filter(op => op.entity_type !== 'product')];
  const data = { processed: 0, failed: 0, errors: [] as { client_id: string; entity_type: string; code: string; message: string }[] };
  // Preserve sale -> void -> cash-close ordering. Only catalog dependencies
  // move ahead; sending every other entity before sales would reverse them.
  for (const op of ordered) {
    if (op.entity_type !== 'sale' || op.operation !== 'create') {
      const target = typeof op.data.branch_id === 'string' ? op.data.branch_id : branchId;
      const response = await getApi().sync.push([op], target);
      if (!response.success || !response.data) return response;
      data.processed += response.data.processed;
      data.failed += response.data.failed;
      data.errors.push(...response.data.errors);
      continue;
    }
    try {
      if (!Array.isArray(op.data.items)) throw Object.assign(new Error('La venta no contiene items válidos'), { status: 400 });
      const payload = reconcileSaleProductIds({ ...op.data, branch_id: op.data.branch_id ?? branchId,
        idempotency_key: op.data.idempotency_key || op.data.id || op.client_id });
      const created = await getApi().sales.create(payload as unknown as SalePayload);
      confirmLocalSale(String(op.data.id ?? op.client_id), created);
      data.processed++;
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      data.failed++;
      data.errors.push({ client_id: op.client_id, entity_type: op.entity_type,
        code: status === 400 || status === 422 ? 'VALIDATION_ERROR' : 'RETRY_REQUIRED',
        message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { success: true, data };
};
