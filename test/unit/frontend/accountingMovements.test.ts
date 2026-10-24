import { describe, it, expect } from 'vitest';
import type { Expense, Sale } from '../../../apps/pos-pc/src/types';
import {
  buildAccountingMovements,
  filterAccountingMovements,
  calculateAccountingTotals,
} from '../../../apps/pos-pc/src/utils/accounting';

describe('accounting utils: buildAccountingMovements', () => {
  const sampleExpenses: Expense[] = [
    {
      id: 'exp-1',
      concept: 'Harina 000 x 50kg',
      category: 'materia_prima',
      amount: 45000,
      date: '2026-10-24T10:00:00Z',
      paymentMethod: 'Transferencia Bancaria',
    },
    {
      id: 'exp-2',
      concept: 'Factura de Luz Edenor',
      category: 'servicios',
      amount: 28000,
      date: '2026-10-24T12:00:00Z',
      paymentMethod: 'Débito Automático',
    },
  ];

  const sampleSales: Sale[] = [
    {
      id: 'sale-1',
      invoiceNumber: 'T-0001',
      documentNumber: 101,
      documentType: 'ticket',
      date: '2026-10-24T11:00:00Z',
      items: [{ productId: 'p1', name: 'Medialuna manteca', quantity: 12, price: 500, subtotal: 6000 }],
      total: 6000,
      tax: 1041.32,
      subtotal_bruto: 6000,
      discount_total: 0,
      total_final: 6000,
      idempotencyKey: 'k-1',
      paymentMethod: 'efectivo',
      paymentStatus: 'completed',
      operatorRole: 'cajero',
      operatorName: 'Juan',
    },
    {
      id: 'sale-2',
      invoiceNumber: 'FAC-0002',
      documentNumber: 'A-00000042',
      documentType: 'factura_a',
      customerName: 'Café Martínez',
      customerDoc: '30-71122334-9',
      date: '2026-10-24T14:00:00Z',
      items: [{ productId: 'p2', name: 'Facturas surtidas', quantity: 36, price: 500, subtotal: 18000 }],
      total: 18000,
      tax: 3123.96,
      subtotal_bruto: 18000,
      discount_total: 0,
      total_final: 18000,
      idempotencyKey: 'k-2',
      paymentMethod: 'transferencia',
      paymentStatus: 'completed',
      operatorRole: 'admin',
      operatorName: 'Carlos',
    },
  ];

  it('unifica egresos y ventas exitosas en un único listado ordenado por fecha descendente', () => {
    const movements = buildAccountingMovements(sampleExpenses, sampleSales);

    expect(movements).toHaveLength(4);
    // Mas reciente primero: 14:00 (sale-2), 12:00 (exp-2), 11:00 (sale-1), 10:00 (exp-1)
    expect(movements[0].id).toBe('A-00000042');
    expect(movements[0].type).toBe('ingreso');
    expect(movements[0].amount).toBe(18000);
    expect(movements[0].concept).toContain('Café Martínez');

    expect(movements[1].id).toBe('exp-2');
    expect(movements[1].type).toBe('egreso');
    expect(movements[1].amount).toBe(28000);

    expect(movements[2].id).toBe('101');
    expect(movements[2].type).toBe('ingreso');
    expect(movements[2].amount).toBe(6000);

    expect(movements[3].id).toBe('exp-1');
    expect(movements[3].type).toBe('egreso');
    expect(movements[3].amount).toBe(45000);
  });

  it('asigna categorías e indicadores legibles para ventas e ingresos', () => {
    const movements = buildAccountingMovements([], [sampleSales[0]]);
    expect(movements[0].type).toBe('ingreso');
    expect(movements[0].category).toBe('ventas');
    expect(movements[0].categoryLabel).toBe('Ventas · Ticket');
    expect(movements[0].paymentMethod).toBe('💵 Efectivo');
  });
});

describe('accounting utils: filterAccountingMovements', () => {
  const expenses: Expense[] = [
    {
      id: 'exp-1',
      concept: 'Harina 000 x 50kg',
      category: 'materia_prima',
      amount: 45000,
      date: '2026-10-24T10:00:00Z',
      paymentMethod: 'Transferencia Bancaria',
    },
    {
      id: 'exp-2',
      concept: 'Servicio de Internet Fibertel',
      category: 'servicios',
      amount: 15000,
      date: '2026-10-24T12:00:00Z',
      paymentMethod: 'Débito Automático',
    },
  ];

  const sales: Sale[] = [
    {
      id: 'sale-1',
      invoiceNumber: 'T-0001',
      date: '2026-10-24T11:00:00Z',
      items: [{ productId: 'p1', name: 'Medialunas', quantity: 6, price: 500, subtotal: 3000 }],
      total: 3000,
      tax: 520,
      subtotal_bruto: 3000,
      discount_total: 0,
      total_final: 3000,
      idempotencyKey: 'k-1',
      paymentMethod: 'efectivo',
      paymentStatus: 'completed',
      operatorRole: 'cajero',
      operatorName: 'Ana',
    },
    {
      id: 'sale-2',
      invoiceNumber: 'T-0002',
      customerName: 'Panadería Central',
      date: '2026-10-24T13:00:00Z',
      items: [{ productId: 'p2', name: 'Pan de campo', quantity: 10, price: 1000, subtotal: 10000 }],
      total: 10000,
      tax: 1735,
      subtotal_bruto: 10000,
      discount_total: 0,
      total_final: 10000,
      idempotencyKey: 'k-2',
      paymentMethod: 'qr',
      paymentStatus: 'completed',
      operatorRole: 'cajero',
      operatorName: 'Ana',
    },
  ];

  const movements = buildAccountingMovements(expenses, sales);

  it('con filtro "todos" devuelve tanto ingresos como egresos', () => {
    const filtered = filterAccountingMovements(movements, { type: 'todos' });
    expect(filtered).toHaveLength(4);
    expect(filtered.filter(m => m.type === 'ingreso')).toHaveLength(2);
    expect(filtered.filter(m => m.type === 'egreso')).toHaveLength(2);
  });

  it('con filtro "ingreso" devuelve únicamente entradas de dinero (ventas)', () => {
    const filtered = filterAccountingMovements(movements, { type: 'ingreso' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every(m => m.type === 'ingreso')).toBe(true);
    expect(filtered.map(m => m.amount)).toEqual([10000, 3000]);
  });

  it('con filtro "egreso" devuelve únicamente salidas de dinero (gastos)', () => {
    const filtered = filterAccountingMovements(movements, { type: 'egreso' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every(m => m.type === 'egreso')).toBe(true);
    expect(filtered.map(m => m.amount)).toEqual([15000, 45000]);
  });

  it('filtra por categoría contable específica', () => {
    const filteredMateriaPrima = filterAccountingMovements(movements, {
      type: 'todos',
      category: 'materia_prima',
    });
    expect(filteredMateriaPrima).toHaveLength(1);
    expect(filteredMateriaPrima[0].concept).toContain('Harina');

    const filteredVentas = filterAccountingMovements(movements, {
      type: 'todos',
      category: 'ventas',
    });
    expect(filteredVentas).toHaveLength(2);
    expect(filteredVentas.every(m => m.type === 'ingreso')).toBe(true);
  });

  it('filtra por búsqueda de texto (ID, concepto, cliente o medio de pago)', () => {
    const searchClient = filterAccountingMovements(movements, {
      type: 'todos',
      searchQuery: 'Panadería Central',
    });
    expect(searchClient).toHaveLength(1);
    expect(searchClient[0].concept).toContain('Panadería Central');

    const searchInternet = filterAccountingMovements(movements, {
      type: 'todos',
      searchQuery: 'Fibertel',
    });
    expect(searchInternet).toHaveLength(1);
    expect(searchInternet[0].concept).toContain('Internet');
  });
});

describe('accounting utils: calculateAccountingTotals', () => {
  it('calcula sumas de ingresos, egresos y balance neto correctamente', () => {
    const movements = [
      {
        id: '1',
        type: 'ingreso' as const,
        concept: 'Venta',
        category: 'ventas',
        categoryLabel: 'Ventas',
        date: '2026-10-24T10:00:00Z',
        paymentMethod: 'Efectivo',
        amount: 25000,
      },
      {
        id: '2',
        type: 'ingreso' as const,
        concept: 'Venta 2',
        category: 'ventas',
        categoryLabel: 'Ventas',
        date: '2026-10-24T11:00:00Z',
        paymentMethod: 'QR',
        amount: 15000,
      },
      {
        id: '3',
        type: 'egreso' as const,
        concept: 'Gas natural',
        category: 'servicios',
        categoryLabel: 'Servicios',
        date: '2026-10-24T12:00:00Z',
        paymentMethod: 'Transferencia',
        amount: 10000,
      },
    ];

    const totals = calculateAccountingTotals(movements);

    expect(totals.totalIncome).toBe(40000);
    expect(totals.totalExpense).toBe(10000);
    expect(totals.netBalance).toBe(30000);
    expect(totals.count).toBe(3);
    expect(totals.incomeCount).toBe(2);
    expect(totals.expenseCount).toBe(1);
  });

  it('calcula balance negativo si los egresos superan los ingresos', () => {
    const movements = [
      {
        id: '1',
        type: 'ingreso' as const,
        concept: 'Venta',
        category: 'ventas',
        categoryLabel: 'Ventas',
        date: '2026-10-24T10:00:00Z',
        paymentMethod: 'Efectivo',
        amount: 5000,
      },
      {
        id: '2',
        type: 'egreso' as const,
        concept: 'Alquiler',
        category: 'alquiler',
        categoryLabel: 'Alquiler',
        date: '2026-10-24T11:00:00Z',
        paymentMethod: 'Transferencia',
        amount: 50000,
      },
    ];

    const totals = calculateAccountingTotals(movements);
    expect(totals.netBalance).toBe(-45000);
  });
});
