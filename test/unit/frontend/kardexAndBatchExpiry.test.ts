import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Product, ProductBatch } from '../../../apps/pos-pc/src/types';
import { exportKardexToCSV, type KardexExportItem } from '../../../apps/pos-pc/src/utils/exportUtils';

describe('Kardex / Historial de Movimientos de Stock', () => {
  // Pure logic replica for badge resolution & movement direction
  function getMovementBadgeInfo(movementType: string, reason?: string) {
    const isRotura = reason && reason.toLowerCase().includes('rotura');
    if (movementType === 'sale_out' || movementType === 'sale') {
      return { label: 'Venta', sign: '-', isInbound: false };
    }
    if (movementType === 'production_in' || movementType === 'production') {
      return { label: 'Producción', sign: '+', isInbound: true };
    }
    if (movementType === 'waste_out' || movementType === 'production_waste' || movementType === 'waste') {
      return { label: isRotura ? 'Rotura' : 'Merma / Desecho', sign: '-', isInbound: false };
    }
    if (movementType === 'adjustment_in') {
      return { label: 'Ajuste / Conteo (+)', sign: '+', isInbound: true };
    }
    if (movementType === 'adjustment_out') {
      return { label: 'Ajuste / Conteo (-)', sign: '-', isInbound: false };
    }
    if (movementType === 'purchase_in' || movementType === 'purchase') {
      return { label: 'Compra / Ingreso', sign: '+', isInbound: true };
    }
    return { label: 'Movimiento', sign: '+', isInbound: true };
  }

  // Running balance calculation helper
  function computeRunningBalances(
    currentStock: number,
    movements: { id: string; quantity: number; isInbound: boolean; createdAt: string }[]
  ) {
    // Sort chronologically ascending
    const sorted = [...movements].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const totalDelta = sorted.reduce(
      (sum, m) => sum + (m.isInbound ? m.quantity : -m.quantity),
      0
    );
    let baseStock = Math.max(0, currentStock - totalDelta);

    return sorted.map((m) => {
      const delta = m.isInbound ? m.quantity : -m.quantity;
      baseStock = parseFloat((baseStock + delta).toFixed(3));
      return {
        ...m,
        balance: baseStock,
      };
    });
  }

  it('resuelve correctamente tipos de movimientos y signos', () => {
    expect(getMovementBadgeInfo('sale_out')).toEqual({ label: 'Venta', sign: '-', isInbound: false });
    expect(getMovementBadgeInfo('production_in')).toEqual({ label: 'Producción', sign: '+', isInbound: true });
    expect(getMovementBadgeInfo('waste_out', 'Pan endurecido')).toEqual({
      label: 'Merma / Desecho',
      sign: '-',
      isInbound: false,
    });
    expect(getMovementBadgeInfo('waste_out', 'Rotura de bandeja matutina')).toEqual({
      label: 'Rotura',
      sign: '-',
      isInbound: false,
    });
    expect(getMovementBadgeInfo('adjustment_in')).toEqual({
      label: 'Ajuste / Conteo (+)',
      sign: '+',
      isInbound: true,
    });
    expect(getMovementBadgeInfo('adjustment_out')).toEqual({
      label: 'Ajuste / Conteo (-)',
      sign: '-',
      isInbound: false,
    });
    expect(getMovementBadgeInfo('purchase_in')).toEqual({
      label: 'Compra / Ingreso',
      sign: '+',
      isInbound: true,
    });
  });

  it('calcula balances de stock acumulados por producto de forma consistente', () => {
    // Current stock in system is 25
    // Movements:
    // T1: +20 (production)
    // T2: -5 (sale)
    // T3: +10 (adjust)
    const currentStock = 25;
    const movements = [
      { id: 'm1', quantity: 20, isInbound: true, createdAt: '2026-11-14T01:00:00Z' },
      { id: 'm2', quantity: 5, isInbound: false, createdAt: '2026-11-14T02:00:00Z' },
      { id: 'm3', quantity: 10, isInbound: true, createdAt: '2026-11-14T03:00:00Z' },
    ];

    const results = computeRunningBalances(currentStock, movements);

    expect(results[0].balance).toBe(20);
    expect(results[1].balance).toBe(15);
    expect(results[2].balance).toBe(25);
  });

  it('unifica y deduplica movimientos remotos y locales offline', () => {
    const remote = [
      { id: 'mov-1', product_id: 'p1', movement_type: 'sale_out', quantity: 2 },
      { id: 'mov-2', product_id: 'p2', movement_type: 'production_in', quantity: 50 },
    ];
    const local = [
      { id: 'mov-2', product_id: 'p2', movement_type: 'production_in', quantity: 50 }, // duplicate
      { id: 'mov-3-offline', product_id: 'p1', movement_type: 'waste_out', quantity: 3 },
    ];

    const seenIds = new Set<string>();
    const unified: any[] = [];
    for (const item of [...local, ...remote]) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      unified.push(item);
    }

    expect(unified.length).toBe(3);
    expect(unified.map((u) => u.id)).toEqual(['mov-2', 'mov-3-offline', 'mov-1']);
  });

  it('filtra movimientos por texto, tipo de movimiento y rango de fecha', () => {
    const items = [
      { id: '1', productName: 'Medialuna de Manteca', productCode: 'MED-M', movementType: 'sale_out', reason: 'Venta #101', createdAt: '2026-11-10T10:00:00Z' },
      { id: '2', productName: 'Pan Francés', productCode: 'PAN-F', movementType: 'production_in', reason: 'Horneada mañana', createdAt: '2026-11-12T07:00:00Z' },
      { id: '3', productName: 'Medialuna de Grasa', productCode: 'MED-G', movementType: 'waste_out', reason: 'Merma por vencimiento', createdAt: '2026-11-13T18:00:00Z' },
      { id: '4', productName: 'Baguette', productCode: 'BAG-1', movementType: 'waste_out', reason: 'Rotura de traslado', createdAt: '2026-11-14T09:00:00Z' },
    ];

    // Filter by text search "medialuna"
    const searchMatch = items.filter(i => i.productName.toLowerCase().includes('medialuna'));
    expect(searchMatch.length).toBe(2);

    // Filter by type "waste" (including rotura)
    const wasteMatch = items.filter(i => i.movementType.includes('waste'));
    expect(wasteMatch.length).toBe(2);

    // Filter by date range (from 2026-11-11 to 2026-11-13)
    const dateMatch = items.filter(i => {
      const d = i.createdAt.slice(0, 10);
      return d >= '2026-11-11' && d <= '2026-11-13';
    });
    expect(dateMatch.length).toBe(2);
    expect(dateMatch.map(i => i.id)).toEqual(['2', '3']);
  });

  it('exportKardexToCSV formatea adecuadamente y descarga el archivo CSV', () => {
    const clickSpy = vi.fn();
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

    const origCreateElement = document.createElement.bind(document);
    let capturedLink: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName === 'a') {
        el.click = clickSpy;
        capturedLink = el as HTMLAnchorElement;
      }
      return el;
    });

    const exportData: KardexExportItem[] = [
      {
        id: 'k1',
        createdAt: '2026-11-14T10:30:00Z',
        productName: 'Medialuna de Manteca',
        productCode: 'MED-01',
        movementType: 'sale_out',
        movementTypeLabel: 'Venta',
        quantity: -12,
        unit: 'u',
        balance: 48,
        reason: 'Venta Mostrador #501',
        operatorName: 'Juan Pérez',
      },
      {
        id: 'k2',
        createdAt: '2026-11-14T11:00:00Z',
        productName: 'Harina 000',
        productCode: 'INS-01',
        movementType: 'production_in',
        movementTypeLabel: 'Producción',
        quantity: 50,
        unit: 'kg',
        balance: 150,
        reason: 'Ingreso Proveedor',
        operatorName: 'Admin',
      },
    ];

    exportKardexToCSV(exportData);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(capturedLink).not.toBeNull();
    expect(capturedLink?.getAttribute('download')).toMatch(/^kardex_movimientos_\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('Control de Caducidad Conectado a Lotes Reales (batches)', () => {
  const mockProducts: Product[] = [
    {
      id: 'p1',
      name: 'Medialuna de Manteca',
      price: 600,
      cost: 200,
      stock: 45,
      minStock: 10,
      category: 'facturas',
      unit: 'u',
      ingredients: [],
      durabilityDays: 3,
    },
    {
      id: 'p2',
      name: 'Torta de Frutilla Fina',
      price: 5000,
      cost: 1500,
      stock: 3,
      minStock: 1,
      category: 'pasteleria',
      unit: 'u',
      ingredients: [],
      durabilityDays: 2,
    },
    {
      id: 'p3',
      name: 'Pan Baguette',
      price: 1200,
      cost: 400,
      stock: 20,
      minStock: 5,
      category: 'panes',
      unit: 'u',
      ingredients: [],
      durabilityDays: 1,
    },
  ];

  function getBatchExpiryDays(batchExpiryDate: string, referenceToday: string): number {
    if (!batchExpiryDate) return 999;
    const exp = new Date(batchExpiryDate + 'T00:00:00');
    const today = new Date(referenceToday + 'T00:00:00');
    const diffTime = exp.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  function getBatchLifeProgress(
    elabDate: string,
    expDate: string,
    referenceToday: string
  ): { totalDays: number; elapsedDays: number; percent: number } {
    const elab = new Date(elabDate + 'T00:00:00');
    const exp = new Date(expDate + 'T00:00:00');
    const totalDays = Math.max(1, Math.round((exp.getTime() - elab.getTime()) / (1000 * 60 * 60 * 24)));
    const today = new Date(referenceToday + 'T00:00:00');
    const elapsedDays = Math.round((today.getTime() - elab.getTime()) / (1000 * 60 * 60 * 24));
    const percent = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
    return { totalDays, elapsedDays, percent };
  }

  it('calcula días de caducidad respecto a la fecha actual correctamente', () => {
    const today = '2026-11-14';

    // Batch expiring in 2 days
    expect(getBatchExpiryDays('2026-11-16', today)).toBe(2);

    // Batch expiring today
    expect(getBatchExpiryDays('2026-11-14', today)).toBe(0);

    // Batch expired yesterday
    expect(getBatchExpiryDays('2026-11-13', today)).toBe(-1);

    // Batch expired 5 days ago
    expect(getBatchExpiryDays('2026-11-09', today)).toBe(-5);
  });

  it('calcula porcentaje y vida útil para la barra de progreso', () => {
    const today = '2026-11-14';

    // 4 days total life, 2 days elapsed -> 50%
    const midLife = getBatchLifeProgress('2026-11-12', '2026-11-16', today);
    expect(midLife.totalDays).toBe(4);
    expect(midLife.elapsedDays).toBe(2);
    expect(midLife.percent).toBe(50);

    // Expired batch -> clamped to 100%
    const expired = getBatchLifeProgress('2026-11-01', '2026-11-10', today);
    expect(expired.percent).toBe(100);

    // Fresh batch baked today -> 0%
    const fresh = getBatchLifeProgress('2026-11-14', '2026-11-18', today);
    expect(fresh.percent).toBe(0);
  });

  it('clasifica alertas de color: verde (>3d), amarillo (<=3d), rojo (vencido)', () => {
    function resolveStatusBadge(daysLeft: number) {
      if (daysLeft < 0) return { status: 'expired', badge: '🚨 VENCIDO', color: 'red' };
      if (daysLeft <= 3) return { status: 'critical', badge: '⏳ POR VENCER', color: 'amber' };
      return { status: 'fresh', badge: '✅ FRESCO', color: 'emerald' };
    }

    expect(resolveStatusBadge(-2)).toEqual({ status: 'expired', badge: '🚨 VENCIDO', color: 'red' });
    expect(resolveStatusBadge(0)).toEqual({ status: 'critical', badge: '⏳ POR VENCER', color: 'amber' });
    expect(resolveStatusBadge(2)).toEqual({ status: 'critical', badge: '⏳ POR VENCER', color: 'amber' });
    expect(resolveStatusBadge(3)).toEqual({ status: 'critical', badge: '⏳ POR VENCER', color: 'amber' });
    expect(resolveStatusBadge(5)).toEqual({ status: 'fresh', badge: '✅ FRESCO', color: 'emerald' });
  });

  it('ordena lotes priorizando vencidos y próximos a vencer, y resolviendo empates según criterio', () => {
    const today = '2026-11-14';

    const testBatches: ProductBatch[] = [
      {
        id: 'b-fresh',
        productId: 'p1', // Medialuna $600
        batchNumber: 'L-MED-FRESH',
        quantity: 50,
        stock: 50,
        elaborationDate: '2026-11-14',
        expiryDate: '2026-11-20', // 6 days
        status: 'active',
        withdrawalMode: 'manual',
      },
      {
        id: 'b-expired',
        productId: 'p3', // Baguette $1200
        batchNumber: 'L-BAG-EXP',
        quantity: 20,
        stock: 10,
        elaborationDate: '2026-11-10',
        expiryDate: '2026-11-12', // -2 days (expired)
        status: 'active',
        withdrawalMode: 'manual',
      },
      {
        id: 'b-today-cake',
        productId: 'p2', // Torta $5000, cat: pasteleria
        batchNumber: 'L-TOR-TODAY',
        quantity: 5,
        stock: 3,
        elaborationDate: '2026-11-12',
        expiryDate: '2026-11-14', // 0 days (today)
        status: 'active',
        withdrawalMode: 'manual',
      },
      {
        id: 'b-today-med',
        productId: 'p1', // Medialuna $600, cat: facturas
        batchNumber: 'L-MED-TODAY',
        quantity: 30,
        stock: 25,
        elaborationDate: '2026-11-11',
        expiryDate: '2026-11-14', // 0 days (today)
        status: 'active',
        withdrawalMode: 'manual',
      },
    ];

    // Priority sort function with criterion
    function sortBatches(batches: ProductBatch[], criteria: 'precio' | 'unidades' | 'categoria', priorityCat = 'pasteleria') {
      return [...batches].sort((a, b) => {
        const daysA = getBatchExpiryDays(a.expiryDate, today);
        const daysB = getBatchExpiryDays(b.expiryDate, today);
        if (daysA !== daysB) return daysA - daysB;

        const prodA = mockProducts.find(p => p.id === a.productId);
        const prodB = mockProducts.find(p => p.id === b.productId);

        if (criteria === 'precio') {
          return (prodB?.price ?? 0) - (prodA?.price ?? 0);
        } else if (criteria === 'unidades') {
          return b.stock - a.stock;
        } else if (criteria === 'categoria') {
          const isA_Prio = prodA?.category === priorityCat ? 1 : 0;
          const isB_Prio = prodB?.category === priorityCat ? 1 : 0;
          return isB_Prio - isA_Prio;
        }
        return 0;
      });
    }

    // 1. Expired is ALWAYS first
    const sortedByPrice = sortBatches(testBatches, 'precio');
    expect(sortedByPrice[0].id).toBe('b-expired');

    // 2. Tie between b-today-cake ($5000) and b-today-med ($600):
    // Under 'precio': b-today-cake should come before b-today-med
    expect(sortedByPrice[1].id).toBe('b-today-cake');
    expect(sortedByPrice[2].id).toBe('b-today-med');
    expect(sortedByPrice[3].id).toBe('b-fresh');

    // Under 'unidades': b-today-med (25 u.) should come before b-today-cake (3 u.)
    const sortedByUnits = sortBatches(testBatches, 'unidades');
    expect(sortedByUnits[0].id).toBe('b-expired');
    expect(sortedByUnits[1].id).toBe('b-today-med');
    expect(sortedByUnits[2].id).toBe('b-today-cake');

    // Under 'categoria' (priority: 'pasteleria'): cake comes first
    const sortedByCat = sortBatches(testBatches, 'categoria', 'pasteleria');
    expect(sortedByCat[1].id).toBe('b-today-cake');
  });

  it('procesa el descuento de merma en lote y actualiza estado a withdrawn al agotarse', () => {
    let currentBatches: ProductBatch[] = [
      {
        id: 'batch-waste-target',
        productId: 'p1',
        batchNumber: 'L-MED-WASTE',
        quantity: 15,
        stock: 15,
        elaborationDate: '2026-11-10',
        expiryDate: '2026-11-13',
        status: 'active',
        withdrawalMode: 'manual',
      },
    ];

    // Simula la confirmación de ajuste por merma del lote completo (-15)
    const delta = -15;
    const targetBatchId = 'batch-waste-target';

    currentBatches = currentBatches.map(b => {
      if (b.id === targetBatchId) {
        const nextStock = Math.max(0, b.stock + delta);
        return {
          ...b,
          stock: nextStock,
          status: nextStock === 0 ? 'withdrawn' : b.status,
        };
      }
      return b;
    });

    expect(currentBatches[0].stock).toBe(0);
    expect(currentBatches[0].status).toBe('withdrawn');
  });
});
