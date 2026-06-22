import { describe, it, expect } from 'vitest';

// Exact replica from workers/api/src/utils/time.ts
function nowSqliteTs(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

describe('nowSqliteTs', () => {
  it('matches SQLite-compatible format YYYY-MM-DD HH:MM:SS', () => {
    expect(nowSqliteTs()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('does not contain the ISO T separator', () => {
    expect(nowSqliteTs()).not.toContain('T');
  });

  it('does not contain the UTC Z marker', () => {
    expect(nowSqliteTs()).not.toContain('Z');
  });

  it('does not contain milliseconds', () => {
    expect(nowSqliteTs()).not.toContain('.');
  });

  it('is exactly 19 characters long', () => {
    expect(nowSqliteTs()).toHaveLength(19);
  });
});
