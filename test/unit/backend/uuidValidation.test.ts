import { describe, it, expect } from 'vitest';

// Exact regex from workers/api/src/routes/expenses.ts
// Used as: /^[0-9a-f]{32}$/i.test(body.id)
function isValidId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id);
}

describe('UUID client-supplied ID validation', () => {
  it('accepts a valid 32-char lowercase hex string', () => {
    expect(isValidId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true);
  });

  it('accepts a valid 32-char uppercase hex string (regex is case-insensitive)', () => {
    expect(isValidId('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4')).toBe(true);
  });

  it('accepts all-zeros UUID without dashes', () => {
    expect(isValidId('00000000000000000000000000000001')).toBe(true);
  });

  it('rejects standard UUID format with dashes', () => {
    // The system stores UUIDs without dashes; dashes are not [0-9a-f]
    expect(isValidId('a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('rejects path traversal attempt', () => {
    expect(isValidId('../etc')).toBe(false);
  });

  it('rejects 31-character string (too short)', () => {
    expect(isValidId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d')).toBe(false);
  });

  it('rejects 33-character string (too long)', () => {
    expect(isValidId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e')).toBe(false);
  });

  it('rejects non-hex characters (g)', () => {
    // Replace last char with 'g' — valid length but invalid char
    expect(isValidId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3dg')).toBe(false);
  });

  it('rejects non-hex characters (z)', () => {
    expect(isValidId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3dz')).toBe(false);
  });

  it('rejects non-hex characters (!)', () => {
    expect(isValidId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d!')).toBe(false);
  });
});
