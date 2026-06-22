import { describe, it, expect } from 'vitest';

// Replica de la generación de IDs en
// apps/pos-pc/src/hooks/useSupplyRequests.ts → requestSupply.
// El backend valida que el id de SupplyRequest matchee /^[0-9a-f]{32}$/
// (UUID hex sin guiones). El generador anterior usaba `sup_req_${Date.now()}...`,
// que el backend rechazaba.
//
// Encapsulamos la generación como función pura para testearla en aislamiento
// sin depender de React.
function generateSupplyRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

describe('generateSupplyRequestId (useSupplyRequests)', () => {
  it('retorna un string', () => {
    const id = generateSupplyRequestId();
    expect(typeof id).toBe('string');
  });

  it('tiene exactamente 32 caracteres', () => {
    const id = generateSupplyRequestId();
    expect(id).toHaveLength(32);
  });

  it('cumple el formato hex sin guiones /^[0-9a-f]{32}$/', () => {
    const id = generateSupplyRequestId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('no contiene guiones (formato canónico del backend)', () => {
    const id = generateSupplyRequestId();
    expect(id.includes('-')).toBe(false);
  });

  it('no usa el prefijo `sup_req_` que rompía el backend', () => {
    const id = generateSupplyRequestId();
    expect(id.startsWith('sup_req_')).toBe(false);
  });

  it('dos llamadas consecutivas son distintas', () => {
    const a = generateSupplyRequestId();
    const b = generateSupplyRequestId();
    expect(a).not.toBe(b);
  });

  it('1000 llamadas: no colisiona (sanity check sobre UUIDv4)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSupplyRequestId());
    }
    expect(ids.size).toBe(1000);
  });
});
