import type { Expense, Sale } from '../types';

export type AccountingMovementType = 'ingreso' | 'egreso';

export interface AccountingMovement {
  id: string;
  type: AccountingMovementType;
  concept: string;
  category: string;
  categoryLabel: string;
  date: string;
  paymentMethod: string;
  amount: number;
  rawSale?: Sale;
  rawExpense?: Expense;
}

export interface MovementFilters {
  type: 'todos' | 'ingreso' | 'egreso';
  category?: string;
  searchQuery?: string;
}

export interface AccountingTotals {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  count: number;
  incomeCount: number;
  expenseCount: number;
}

const PM_LABELS: Record<string, string> = {
  efectivo: '💵 Efectivo',
  qr: '📱 QR / Digital',
  tarjeta: '💳 Tarjeta',
  transferencia: '🏦 Transferencia',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
};

/**
 * Convierte egresos y ventas exitosas en un listado unificado de movimientos contables,
 * ordenados cronológicamente por fecha descendente (más recientes primero).
 */
export function buildAccountingMovements(
  expenses: Expense[],
  successfulSales: Sale[]
): AccountingMovement[] {
  const expenseMovements: AccountingMovement[] = expenses.map(exp => ({
    id: exp.id,
    type: 'egreso' as const,
    concept: exp.concept,
    category: exp.category,
    categoryLabel: exp.category.replace('_', ' '),
    date: exp.date,
    paymentMethod: exp.paymentMethod,
    amount: exp.amount,
    rawExpense: exp,
  }));

  const saleMovements: AccountingMovement[] = successfulSales.map(sale => {
    const docNum =
      sale.documentNumber !== undefined && sale.documentNumber !== null && sale.documentNumber !== ''
        ? String(sale.documentNumber)
        : sale.invoiceNumber;

    const docLabel = DOC_TYPE_LABELS[sale.documentType ?? 'ticket'] ?? 'Venta';

    const itemsSummary =
      sale.items && sale.items.length > 0
        ? `${sale.items.reduce((sum, item) => sum + item.quantity, 0)} u. (${sale.items
            .map(i => i.name)
            .slice(0, 2)
            .join(', ')}${sale.items.length > 2 ? '…' : ''})`
        : 'Venta mostrador';

    return {
      id: docNum,
      type: 'ingreso' as const,
      concept: sale.customerName
        ? `Venta a ${sale.customerName} (${itemsSummary})`
        : `Venta Mostrador (${itemsSummary})`,
      category: 'ventas',
      categoryLabel: `Ventas · ${docLabel}`,
      date: sale.date,
      paymentMethod: PM_LABELS[sale.paymentMethod] ?? sale.paymentMethod,
      amount: sale.total,
      rawSale: sale,
    };
  });

  return [...expenseMovements, ...saleMovements].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Filtra los movimientos contables según tipo ("todos", "ingreso", "egreso"),
 * categoría y texto de búsqueda.
 */
export function filterAccountingMovements(
  movements: AccountingMovement[],
  filters: MovementFilters
): AccountingMovement[] {
  const { type, category = 'todos', searchQuery = '' } = filters;
  const q = searchQuery.trim().toLowerCase();

  return movements.filter(m => {
    // 1. Filtro por tipo de movimiento
    if (type === 'ingreso' && m.type !== 'ingreso') return false;
    if (type === 'egreso' && m.type !== 'egreso') return false;

    // 2. Filtro por categoría
    if (category !== 'todos' && m.category !== category) return false;

    // 3. Filtro por búsqueda
    if (q) {
      const match =
        m.id.toLowerCase().includes(q) ||
        m.concept.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.categoryLabel.toLowerCase().includes(q) ||
        m.paymentMethod.toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });
}

/**
 * Calcula totales de ingresos, egresos, balance neto y contadores de movimientos.
 */
export function calculateAccountingTotals(movements: AccountingMovement[]): AccountingTotals {
  let totalIncome = 0;
  let totalExpense = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  for (const m of movements) {
    if (m.type === 'ingreso') {
      totalIncome += m.amount;
      incomeCount++;
    } else {
      totalExpense += m.amount;
      expenseCount++;
    }
  }

  return {
    totalIncome,
    totalExpense,
    netBalance: totalIncome - totalExpense,
    count: movements.length,
    incomeCount,
    expenseCount,
  };
}
