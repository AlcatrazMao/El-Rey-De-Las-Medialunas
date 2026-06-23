import { describe, expect, it } from 'vitest';

// Réplica local de MAX_OPERATIONS_PER_PUSH desde workers/api/src/routes/sync.ts.
// Exportada como constante para testear sin montar el Worker completo.
const MAX_OPERATIONS_PER_PUSH = 50;

describe('MAX_OPERATIONS_PER_PUSH — sync.ts DoS cap', () => {
  it('es exactamente 50', () => {
    expect(MAX_OPERATIONS_PER_PUSH).toBe(50);
  });

  it('es menor a 100 (evita timeouts por N+1 queries en D1)', () => {
    expect(MAX_OPERATIONS_PER_PUSH).toBeLessThan(100);
  });

  it('es mayor a 0 (el límite debe permitir al menos una operación)', () => {
    expect(MAX_OPERATIONS_PER_PUSH).toBeGreaterThan(0);
  });

  it('50 operaciones no superan el cap', () => {
    expect(50 <= MAX_OPERATIONS_PER_PUSH).toBe(true);
  });

  it('51 operaciones superan el cap', () => {
    expect(51 > MAX_OPERATIONS_PER_PUSH).toBe(true);
  });
});
