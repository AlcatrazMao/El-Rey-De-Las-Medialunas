import { describe, expect, it } from 'vitest';

// Exact replica from workers/api/src/middleware/audit-log.ts — extractEntityId.
// El fix M1 amplía el regex para aceptar tanto UUIDs con guiones (36 chars)
// como IDs hex de 32 chars sin guiones que produce genId().
function extractEntityId(path: string): string | null {
  const match = path.match(/\/([a-f0-9]{32}|[a-f0-9-]{36})(?:\/|$)/);
  return match ? (match[1] ?? null) : null;
}

describe('extractEntityId (audit-log.ts)', () => {
  it('extracts a 36-char UUID with dashes from the middle of the path', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractEntityId(`/api/v1/sales/${uuid}/items`)).toBe(uuid);
  });

  it('extracts a 36-char UUID with dashes at the end of the path', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractEntityId(`/api/v1/sales/${uuid}`)).toBe(uuid);
  });

  it('extracts a 32-char genId() (no dashes) from the middle of the path', () => {
    const id = 'abcdef0123456789abcdef0123456789';
    expect(extractEntityId(`/api/v1/sales/${id}/void`)).toBe(id);
  });

  it('extracts a 32-char genId() at the end of the path', () => {
    const id = 'abcdef0123456789abcdef0123456789';
    expect(extractEntityId(`/api/v1/sales/${id}`)).toBe(id);
  });

  it('returns null for a path without any ID', () => {
    expect(extractEntityId('/api/v1/sales')).toBeNull();
  });

  it('returns null for a path with a random non-hex segment', () => {
    expect(extractEntityId('/api/v1/sales/just-some-random-string')).toBeNull();
  });

  it('returns null for a 30-char hex string (too short for 32 or 36)', () => {
    expect(extractEntityId('/api/v1/sales/abcdef0123456789abcdef012345')).toBeNull();
  });

  it('returns null for a 33-char hex string (between 32 and 36 without dashes)', () => {
    expect(extractEntityId('/api/v1/sales/abcdef0123456789abcdef0123456789a')).toBeNull();
  });

  it('extracts lowercase hex only — uppercase is not matched', () => {
    expect(extractEntityId('/api/v1/sales/ABCDEF0123456789ABCDEF0123456789')).toBeNull();
  });
});
