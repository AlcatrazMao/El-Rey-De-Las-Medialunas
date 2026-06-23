import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests para el orden de ejecución correcto en handleVoidSale (SalesHistoryView).
 *
 * Invariante crítica: syncVoidSaleToD1 DEBE resolverse exitosamente ANTES de
 * que se mute cualquier estado local (updateProductStock, setBatches, setSales).
 * Si el backend rechaza (403, 409, 500), el frontend NO debe mostrar stock
 * inflado al usuario.
 *
 * Testeamos la lógica pura desacoplada de React, replicando el patrón de
 * handleVoidSale tal como quedó definido en SalesHistoryView.tsx tras el fix.
 */

// ── Tipos mínimos ──────────────────────────────────────────────────────────

interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

interface Sale {
  id: string;
  invoiceNumber: string;
  paymentStatus: 'completed' | 'voided' | 'pending' | 'failed';
  items: SaleItem[];
  total: number;
}

// ── Réplica de handleVoidSale (lógica pura, sin React) ────────────────────

/**
 * Versión purificada de handleVoidSale que acepta sus dependencias como
 * parámetros en lugar de tomarlas de hooks. La semántica es idéntica al
 * componente original: await sync → si ok, mutar estado; si falla, notificar.
 */
async function handleVoidSale(
  sale: Sale,
  deps: {
    syncVoidSaleToD1: (saleId: string, reason: string) => Promise<void>;
    updateProductStock: (productId: string, newStock: number) => void;
    setBatches: (updater: (prev: unknown[]) => unknown[]) => void;
    setSales: (updater: (prev: Sale[]) => Sale[]) => void;
    addSystemNotification: (title: string, message: string, type: string) => void;
    setConfirmVoidId: (id: string | null) => void;
    setSelectedSale: (sale: Sale | null) => void;
    products: Array<{ id: string; stock: number; ingredients: unknown[] }>;
  },
): Promise<void> {
  // Guard against double-void
  if (sale.paymentStatus !== 'completed') return;

  // 1. Backend FIRST — si lanza, no seguimos
  try {
    await deps.syncVoidSaleToD1(sale.id, 'Anulación manual desde historial de ventas');
  } catch {
    deps.addSystemNotification(
      'Error al anular',
      `No se pudo anular la factura ${sale.invoiceNumber}. Verificá la conexión e intentá de nuevo.`,
      'error',
    );
    deps.setConfirmVoidId(null);
    return;
  }

  // 2. Solo llega acá si el backend confirmó
  sale.items.forEach(item => {
    const dbProd = deps.products.find(p => p.id === item.productId);
    if (dbProd) {
      deps.updateProductStock(dbProd.id, dbProd.stock + item.quantity);
    }
  });

  deps.setBatches(prev => prev); // updater call — verificamos que se invoque
  deps.setSales(prev => prev.map(s => (s.id === sale.id ? { ...s, paymentStatus: 'voided' as const } : s)));

  deps.addSystemNotification(
    '💸 Factura Anulada',
    `Factura ${sale.invoiceNumber} anulada. Mercadería e insumos reingresados a inventario.`,
    'warning',
  );
  deps.setConfirmVoidId(null);
  deps.setSelectedSale(null);
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseSale: Sale = {
  id: 'sale_001',
  invoiceNumber: 'FAC-0001',
  paymentStatus: 'completed',
  total: 2500,
  items: [{ productId: 'prod_001', name: 'Medialunas x6', quantity: 6, price: 300 }],
};

const baseProducts = [{ id: 'prod_001', stock: 10, ingredients: [] }];

// ── Tests ─────────────────────────────────────────────────────────────────

describe('handleVoidSale — orden backend-first', () => {
  let syncMock: ReturnType<typeof vi.fn>;
  let updateProductStockMock: ReturnType<typeof vi.fn>;
  let setBatchesMock: ReturnType<typeof vi.fn>;
  let setSalesMock: ReturnType<typeof vi.fn>;
  let addNotificationMock: ReturnType<typeof vi.fn>;
  let setConfirmVoidIdMock: ReturnType<typeof vi.fn>;
  let setSelectedSaleMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    syncMock = vi.fn().mockResolvedValue(undefined);
    updateProductStockMock = vi.fn();
    setBatchesMock = vi.fn();
    setSalesMock = vi.fn();
    addNotificationMock = vi.fn();
    setConfirmVoidIdMock = vi.fn();
    setSelectedSaleMock = vi.fn();
  });

  const makeDeps = () => ({
    syncVoidSaleToD1: syncMock,
    updateProductStock: updateProductStockMock,
    setBatches: setBatchesMock,
    setSales: setSalesMock,
    addSystemNotification: addNotificationMock,
    setConfirmVoidId: setConfirmVoidIdMock,
    setSelectedSale: setSelectedSaleMock,
    products: baseProducts,
  });

  it('si syncVoidSaleToD1 lanza, updateProductStock NO debe ser llamado', async () => {
    syncMock.mockRejectedValue(new Error('403 Forbidden'));

    await handleVoidSale(baseSale, makeDeps());

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(updateProductStockMock).not.toHaveBeenCalled();
  });

  it('si syncVoidSaleToD1 lanza, setBatches NO debe ser llamado', async () => {
    syncMock.mockRejectedValue(new Error('500 Internal Server Error'));

    await handleVoidSale(baseSale, makeDeps());

    expect(setBatchesMock).not.toHaveBeenCalled();
  });

  it('si syncVoidSaleToD1 lanza, setSales NO debe ser llamado', async () => {
    syncMock.mockRejectedValue(new Error('409 Conflict'));

    await handleVoidSale(baseSale, makeDeps());

    expect(setSalesMock).not.toHaveBeenCalled();
  });

  it('si syncVoidSaleToD1 lanza, se muestra notificación de error al usuario', async () => {
    syncMock.mockRejectedValue(new Error('403 Forbidden'));

    await handleVoidSale(baseSale, makeDeps());

    expect(addNotificationMock).toHaveBeenCalledTimes(1);
    const [title, , type] = addNotificationMock.mock.calls[0] as [string, string, string];
    expect(title).toBe('Error al anular');
    expect(type).toBe('error');
  });

  it('si syncVoidSaleToD1 resuelve OK, updateProductStock SÍ debe ser llamado', async () => {
    syncMock.mockResolvedValue(undefined);

    await handleVoidSale(baseSale, makeDeps());

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(updateProductStockMock).toHaveBeenCalledTimes(1);
  });

  it('si syncVoidSaleToD1 resuelve OK, setBatches SÍ debe ser llamado', async () => {
    syncMock.mockResolvedValue(undefined);

    await handleVoidSale(baseSale, makeDeps());

    expect(setBatchesMock).toHaveBeenCalledTimes(1);
  });

  it('si syncVoidSaleToD1 resuelve OK, setSales SÍ debe ser llamado', async () => {
    syncMock.mockResolvedValue(undefined);

    await handleVoidSale(baseSale, makeDeps());

    expect(setSalesMock).toHaveBeenCalledTimes(1);
  });

  it('si syncVoidSaleToD1 resuelve OK, se muestra notificación de éxito', async () => {
    syncMock.mockResolvedValue(undefined);

    await handleVoidSale(baseSale, makeDeps());

    expect(addNotificationMock).toHaveBeenCalledTimes(1);
    const [title, , type] = addNotificationMock.mock.calls[0] as [string, string, string];
    expect(title).toBe('💸 Factura Anulada');
    expect(type).toBe('warning');
  });

  it('syncVoidSaleToD1 recibe el saleId correcto y la razón canónica', async () => {
    await handleVoidSale(baseSale, makeDeps());

    expect(syncMock).toHaveBeenCalledWith(
      'sale_001',
      'Anulación manual desde historial de ventas',
    );
  });

  it('guard: venta ya anulada no invoca sync ni muta estado', async () => {
    const voidedSale: Sale = { ...baseSale, paymentStatus: 'voided' };

    await handleVoidSale(voidedSale, makeDeps());

    expect(syncMock).not.toHaveBeenCalled();
    expect(updateProductStockMock).not.toHaveBeenCalled();
    expect(setSalesMock).not.toHaveBeenCalled();
  });

  it('el stock restaurado usa el valor actual del producto más la cantidad vendida', async () => {
    const prodWithStock = [{ id: 'prod_001', stock: 5, ingredients: [] }];
    const deps = { ...makeDeps(), products: prodWithStock };

    await handleVoidSale(baseSale, deps);

    // stock(5) + quantity(6) = 11
    expect(updateProductStockMock).toHaveBeenCalledWith('prod_001', 11);
  });
});
