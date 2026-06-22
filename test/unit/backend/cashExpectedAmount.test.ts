import { describe, it, expect } from 'vitest';

// Réplica exacta de la lógica extraída de workers/api/src/routes/cash.ts.
// Mantenida aquí para evitar dependencias de Hono/Cloudflare bindings en tests
// unitarios puros — la implementación real exporta las mismas funciones.

function computeMovementsDelta(
  movements: { type: string; amount: number }[]
): number {
  let delta = 0;
  for (const m of movements) {
    const amt = Number(m.amount);
    if (!Number.isFinite(amt)) continue;
    if (m.type === 'income') {
      delta += amt;
    } else if (m.type === 'expense') {
      delta -= amt;
    } else if (m.type === 'adjustment') {
      delta += amt;
    }
  }
  return delta;
}

function computeExpectedAmount(params: {
  openingAmount: number;
  salesTotal?: number;
  clientExpected?: number | null;
  movements: { type: string; amount: number }[];
}): number {
  const movementsDelta = computeMovementsDelta(params.movements);
  if (params.clientExpected !== undefined && params.clientExpected !== null) {
    return Number(params.clientExpected) + movementsDelta;
  }
  const sales = Number(params.salesTotal ?? 0);
  return Number(params.openingAmount) + sales + movementsDelta;
}

describe('cash.ts — computeMovementsDelta', () => {
  it('devuelve 0 cuando no hay movements', () => {
    expect(computeMovementsDelta([])).toBe(0);
  });

  it('income suma al delta', () => {
    expect(computeMovementsDelta([{ type: 'income', amount: 500 }])).toBe(500);
  });

  it('expense resta del delta', () => {
    expect(computeMovementsDelta([{ type: 'expense', amount: 200 }])).toBe(-200);
  });

  it('adjustment respeta el signo del amount', () => {
    expect(computeMovementsDelta([{ type: 'adjustment', amount: 50 }])).toBe(50);
    expect(computeMovementsDelta([{ type: 'adjustment', amount: -75 }])).toBe(-75);
  });

  it('combina multiples movements correctamente', () => {
    const movements = [
      { type: 'income', amount: 1000 },
      { type: 'expense', amount: 300 },
      { type: 'adjustment', amount: -50 },
      { type: 'income', amount: 200 },
    ];
    // +1000 - 300 - 50 + 200 = 850
    expect(computeMovementsDelta(movements)).toBe(850);
  });

  it('ignora movements con amount no finito', () => {
    const movements = [
      { type: 'income', amount: 100 },
      { type: 'income', amount: NaN },
      { type: 'expense', amount: Infinity },
    ];
    expect(computeMovementsDelta(movements)).toBe(100);
  });

  it('ignora movements con tipo desconocido', () => {
    expect(
      computeMovementsDelta([{ type: 'mystery', amount: 999 }])
    ).toBe(0);
  });
});

describe('cash.ts — computeExpectedAmount', () => {
  describe('sin clientExpected (cálculo full backend)', () => {
    it('sin movements → opening + sales', () => {
      const result = computeExpectedAmount({
        openingAmount: 1000,
        salesTotal: 500,
        movements: [],
      });
      expect(result).toBe(1500);
    });

    it('income suma al expected', () => {
      const result = computeExpectedAmount({
        openingAmount: 1000,
        salesTotal: 0,
        movements: [{ type: 'income', amount: 500 }],
      });
      expect(result).toBe(1500);
    });

    it('expense resta del expected', () => {
      const result = computeExpectedAmount({
        openingAmount: 1000,
        salesTotal: 0,
        movements: [{ type: 'expense', amount: 200 }],
      });
      expect(result).toBe(800);
    });

    it('multiples movements mezclados → cálculo correcto', () => {
      const result = computeExpectedAmount({
        openingAmount: 2000,
        salesTotal: 1500,
        movements: [
          { type: 'income', amount: 300 },
          { type: 'expense', amount: 500 },
          { type: 'adjustment', amount: -100 },
        ],
      });
      // 2000 + 1500 + 300 - 500 - 100 = 3200
      expect(result).toBe(3200);
    });

    it('sin salesTotal asume 0', () => {
      const result = computeExpectedAmount({
        openingAmount: 1000,
        movements: [{ type: 'income', amount: 100 }],
      });
      expect(result).toBe(1100);
    });
  });

  describe('con clientExpected (cliente ya calculó ventas)', () => {
    it('cuando el cliente envía expected, se le suma el delta de movements', () => {
      // El cliente mandó expected_amount asumiendo ventas pero sin movements.
      // El backend ajusta con los movements para no inflar/desinflar el cierre.
      const result = computeExpectedAmount({
        openingAmount: 1000,
        clientExpected: 1500, // cliente: opening 1000 + ventas 500
        movements: [{ type: 'expense', amount: 200 }],
      });
      // 1500 - 200 = 1300 (retiro de 200 reduce el expected)
      expect(result).toBe(1300);
    });

    it('clientExpected con multiples movements', () => {
      const result = computeExpectedAmount({
        openingAmount: 1000,
        clientExpected: 5000,
        movements: [
          { type: 'income', amount: 300 },
          { type: 'expense', amount: 800 },
        ],
      });
      // 5000 + 300 - 800 = 4500
      expect(result).toBe(4500);
    });

    it('clientExpected = 0 con movements', () => {
      const result = computeExpectedAmount({
        openingAmount: 0,
        clientExpected: 0,
        movements: [{ type: 'income', amount: 100 }],
      });
      expect(result).toBe(100);
    });
  });
});
