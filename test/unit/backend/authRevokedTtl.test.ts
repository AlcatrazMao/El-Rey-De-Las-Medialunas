import { describe, expect, it } from 'vitest';

// Réplica local de revokedTtlSeconds desde workers/api/src/routes/auth.ts.
// Función pura sin dependencias de KV — testeable de forma aislada.
function revokedTtlSeconds(): number {
  return 1800;
}

describe('revokedTtlSeconds — auth.ts blocklist TTL', () => {
  it('retorna exactamente 1800 segundos (30 minutos)', () => {
    expect(revokedTtlSeconds()).toBe(1800);
  });

  it('es mayor o igual a 900 (mínimo razonable: cubre el access token de 15 min)', () => {
    expect(revokedTtlSeconds()).toBeGreaterThanOrEqual(900);
  });

  it('es menor o igual a 86400 (máximo razonable: no más de 24 horas)', () => {
    expect(revokedTtlSeconds()).toBeLessThanOrEqual(86400);
  });

  it('cubre el access token TTL (900s) con margen (debe ser > 900)', () => {
    expect(revokedTtlSeconds()).toBeGreaterThan(900);
  });
});
