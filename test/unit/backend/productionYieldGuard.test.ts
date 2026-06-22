import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/routes/production.ts /:id/start and
// /:id/complete handlers. The guard validates that recipe_yield is strictly
// positive before computing batchMultiplier = planned_quantity / recipe_yield
// (division by 0 / negative would yield bogus inventory consumption).
//
// Condition in source:
//   if ((batch.recipe_yield ?? 0) <= 0) { ...error... }
//
// We invert to a positive predicate: isValidYield === !((v ?? 0) <= 0)
function isValidYield(v: unknown): boolean {
  // The DB column is typed `number` in the route; we model that here while
  // still exercising the null branch — which is the whole reason for `?? 0`.
  const n = (v as number | null | undefined) ?? 0;
  return n > 0;
}

describe('production recipe_yield guard', () => {
  it('accepts a positive integer yield', () => {
    expect(isValidYield(10)).toBe(true);
  });

  it('accepts a positive fractional yield (0.5)', () => {
    expect(isValidYield(0.5)).toBe(true);
  });

  it('rejects exactly 0', () => {
    expect(isValidYield(0)).toBe(false);
  });

  it('rejects a negative yield', () => {
    expect(isValidYield(-5)).toBe(false);
  });

  it('rejects null (LEFT JOIN miss → recipe_yield IS NULL)', () => {
    expect(isValidYield(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidYield(undefined)).toBe(false);
  });

  it('accepts a very small positive (1e-9)', () => {
    expect(isValidYield(1e-9)).toBe(true);
  });
});
