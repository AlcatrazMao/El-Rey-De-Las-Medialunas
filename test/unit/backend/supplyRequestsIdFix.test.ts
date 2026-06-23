import { describe, it, expect } from 'vitest';

// Replica de la lógica de selección de ID en
// workers/api/src/routes/supply-requests.ts (POST /).
//
// Política: si el cliente envía un id hex-32, lo usamos. Si no matchea o está
// ausente, generamos uno server-side. NUNCA retornamos 400 por un id inválido.

function genId(): string {
  return crypto.randomUUID().replace(/-/g, '').toLowerCase();
}

const HEX32_RE = /^[a-f0-9]{32}$/;

function resolveRequestId(clientId: string | undefined): string {
  const clientIdValid = typeof clientId === 'string' && HEX32_RE.test(clientId);
  return clientIdValid ? clientId : genId();
}

describe('supply-requests POST — resolución de id', () => {
  it('id hex-32 válido → se usa tal cual', () => {
    const validId = 'a'.repeat(32);
    expect(resolveRequestId(validId)).toBe(validId);
  });

  it('id hex-32 mixto válido → se usa tal cual', () => {
    const validId = '0123456789abcdef0123456789abcdef';
    expect(resolveRequestId(validId)).toBe(validId);
  });

  it('id tipo "sup_req_1" → se ignora, se genera nuevo', () => {
    const result = resolveRequestId('sup_req_1');
    expect(result).not.toBe('sup_req_1');
    expect(result).toMatch(HEX32_RE);
  });

  it('id con guiones (UUID canónico) → se ignora, se genera nuevo', () => {
    const uuidWithDashes = '550e8400-e29b-41d4-a716-446655440000';
    const result = resolveRequestId(uuidWithDashes);
    expect(result).not.toBe(uuidWithDashes);
    expect(result).toMatch(HEX32_RE);
  });

  it('id con mayúsculas → se ignora, se genera nuevo (hex-32 requiere lowercase)', () => {
    const upperHex = 'A'.repeat(32);
    const result = resolveRequestId(upperHex);
    expect(result).not.toBe(upperHex);
    expect(result).toMatch(HEX32_RE);
  });

  it('id demasiado corto → se ignora, se genera nuevo', () => {
    const result = resolveRequestId('abc123');
    expect(result).toMatch(HEX32_RE);
  });

  it('id demasiado largo → se ignora, se genera nuevo', () => {
    const result = resolveRequestId('a'.repeat(33));
    expect(result).toMatch(HEX32_RE);
  });

  it('sin id (undefined) → se genera nuevo', () => {
    const result = resolveRequestId(undefined);
    expect(result).toMatch(HEX32_RE);
  });

  it('el ID generado siempre matchea /^[a-f0-9]{32}$/', () => {
    for (let i = 0; i < 50; i++) {
      const result = resolveRequestId(undefined);
      expect(result).toMatch(HEX32_RE);
    }
  });

  it('dos IDs generados son distintos', () => {
    const a = resolveRequestId(undefined);
    const b = resolveRequestId(undefined);
    expect(a).not.toBe(b);
  });

  it('id vacío → se ignora, se genera nuevo', () => {
    const result = resolveRequestId('');
    expect(result).toMatch(HEX32_RE);
  });

  it('id con caracteres especiales → se ignora, se genera nuevo', () => {
    const result = resolveRequestId('abc!@#$%^&*()abc!@#$%^&*()abcde');
    expect(result).toMatch(HEX32_RE);
  });
});
