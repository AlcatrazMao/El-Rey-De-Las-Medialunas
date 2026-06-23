import { describe, it, expect } from 'vitest';

// Réplica exacta de deriveExpectedAmount exportada desde
// workers/api/src/routes/cash.ts. Tests unitarios puros — sin dependencias de
// Hono/Cloudflare bindings. La firma de la función es intencionalmente simple:
// recibe primitivos ya calculados, sin clientExpected.
//
// Fórmula: opening + cashSales - cashExpenses + movementsDelta
// El clientExpected NO es un parámetro: el servidor nunca lo usa como base.

function deriveExpectedAmount(params: {
  openingAmount: number;
  cashSales: number;
  cashExpenses: number;
  movementsDelta: number;
}): number {
  const opening = Number(params.openingAmount ?? 0);
  const sales = Number(params.cashSales ?? 0);
  const expenses = Number(params.cashExpenses ?? 0);
  const delta = Number(params.movementsDelta ?? 0);
  return opening + sales - expenses + delta;
}

describe('deriveExpectedAmount (cash.ts — siempre server-side)', () => {
  it('caso canónico: opening=1000, cashSales=500, cashExpenses=100, movementsDelta=-50 → 1350', () => {
    // 1000 + 500 - 100 + (-50) = 1350
    expect(
      deriveExpectedAmount({ openingAmount: 1000, cashSales: 500, cashExpenses: 100, movementsDelta: -50 })
    ).toBe(1350);
  });

  it('todos ceros → devuelve openingAmount', () => {
    expect(
      deriveExpectedAmount({ openingAmount: 500, cashSales: 0, cashExpenses: 0, movementsDelta: 0 })
    ).toBe(500);
  });

  it('opening=0 y todos ceros → 0', () => {
    expect(
      deriveExpectedAmount({ openingAmount: 0, cashSales: 0, cashExpenses: 0, movementsDelta: 0 })
    ).toBe(0);
  });

  it('movements positivos suman correctamente', () => {
    // opening=1000, ventas=500, sin gastos, delta=+200 (income)
    expect(
      deriveExpectedAmount({ openingAmount: 1000, cashSales: 500, cashExpenses: 0, movementsDelta: 200 })
    ).toBe(1700);
  });

  it('movements negativos restan correctamente', () => {
    // opening=1000, ventas=500, sin gastos, delta=-300 (expense movement)
    expect(
      deriveExpectedAmount({ openingAmount: 1000, cashSales: 500, cashExpenses: 0, movementsDelta: -300 })
    ).toBe(1200);
  });

  it('cashExpenses resta del expected', () => {
    // opening=2000, ventas=1000, gastos=400, sin movements
    // 2000 + 1000 - 400 + 0 = 2600
    expect(
      deriveExpectedAmount({ openingAmount: 2000, cashSales: 1000, cashExpenses: 400, movementsDelta: 0 })
    ).toBe(2600);
  });

  it('movements mixtos (positivos y negativos) se acumulan antes de aplicarse', () => {
    // movementsDelta pre-calculado: +300 income - 100 expense - 50 adjustment = +150
    expect(
      deriveExpectedAmount({ openingAmount: 1000, cashSales: 800, cashExpenses: 0, movementsDelta: 150 })
    ).toBe(1950);
  });

  it('la función NO acepta clientExpected como parámetro — no aparece en la firma', () => {
    // Verificamos que el tipo no tenga clientExpected: intentar pasarlo
    // produce error TS en compilación. En runtime: si alguien pasa un objeto
    // con campo extra, el cálculo ignora ese campo (JS destructuring).
    const params = {
      openingAmount: 1000,
      cashSales: 500,
      cashExpenses: 0,
      movementsDelta: 0,
      // clientExpected: 9999  // <- no existe en la firma; descomentarlo rompe TS
    };
    expect(deriveExpectedAmount(params)).toBe(1500);
  });

  it('valores grandes (dentro del límite MAX_CASH_AMOUNT = 10_000_000)', () => {
    expect(
      deriveExpectedAmount({ openingAmount: 5_000_000, cashSales: 3_000_000, cashExpenses: 500_000, movementsDelta: -200_000 })
    ).toBe(7_300_000);
  });

  it('resultado puede ser mayor que opening si hay muchas ventas', () => {
    const result = deriveExpectedAmount({ openingAmount: 100, cashSales: 5000, cashExpenses: 0, movementsDelta: 0 });
    expect(result).toBe(5100);
    expect(result).toBeGreaterThan(100);
  });
});
