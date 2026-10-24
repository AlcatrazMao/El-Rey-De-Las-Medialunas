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
      try {
        const target = typeof op.data.branch_id === 'string' ? op.data.branch_id : branchId;
      const response = await getApi().sync.push([op], target);
        if (!response.success || !response.data) {
          data.failed++;
          data.errors.push({
            client_id: op.client_id,
            entity_type: op.entity_type,
            code: 'SYNC_ERROR',
            message: 'El servidor rechazó la operación de sincronización',
          });
          continue;
        }
      data.processed += response.data.processed;
      data.failed += response.data.failed;
      data.errors.push(...response.data.errors);
        continue;
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
        data.failed++;
        data.errors.push({
          client_id: op.client_id,
          entity_type: op.entity_type,
          code: status === 400 || status === 422 ? 'VALIDATION_ERROR' : 'RETRY_REQUIRED',
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    try {
      if (!Array.isArray(op.data.items)) throw Object.assign(new Error('La venta no contiene items válidos'), { status: 400 });
      const rawData = op.data as Record<string, unknown>;
      const items = Array.isArray(rawData.items) ? rawData.items : [];
      const itemsSum = items.reduce((acc, it: any) => acc + (Number(it.unit_price ?? it.price ?? 0) * Number(it.quantity ?? 1)), 0);
      const subtotalBruto = typeof rawData.subtotal_bruto === 'number' && !isNaN(rawData.subtotal_bruto)
        ? rawData.subtotal_bruto
        : (itemsSum > 0 ? itemsSum : Number(rawData.total ?? rawData.subtotal ?? 0));
      const totalFinal = typeof rawData.total_final === 'number' && !isNaN(rawData.total_final)
        ? rawData.total_final
        : Number(rawData.total ?? subtotalBruto);
      const discountTotal = typeof rawData.discount_total === 'number' && !isNaN(rawData.discount_total)
        ? rawData.discount_total
        : parseFloat((subtotalBruto - totalFinal).toFixed(2));
      const sanitizedDiscount = Math.abs(subtotalBruto - discountTotal - totalFinal) > 0.05
        ? parseFloat((subtotalBruto - totalFinal).toFixed(2))
        : discountTotal;
      const saleBranch = (typeof rawData.branch_id === 'string' && rawData.branch_id.trim())
        ? rawData.branch_id.trim()
        : branchId;
      const payload = reconcileSaleProductIds({
        ...rawData,
        branch_id: saleBranch,
        subtotal_bruto: subtotalBruto,
        discount_total: sanitizedDiscount,
        total_final: totalFinal,
        subtotal: subtotalBruto,
        total: totalFinal,
        idempotency_key: rawData.idempotency_key || rawData.id || op.client_id,
      });
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
