import { describe, expect, it } from 'vitest';

// Exact replica from workers/api/src/routes/suppliers.ts — escapeLike.
// Escapa backslash, %, _ para usar con LIKE ? ESCAPE '\\'.
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

describe('escapeLike (suppliers.ts)', () => {
  it('returns plain text unchanged', () => {
    expect(escapeLike('panaderia')).toBe('panaderia');
  });

  it('escapes leading and trailing % characters', () => {
    expect(escapeLike('%descuento%')).toBe('\\%descuento\\%');
  });

  it('escapes underscore characters', () => {
    expect(escapeLike('pan_dulce')).toBe('pan\\_dulce');
  });

  it('escapes a trailing backslash by doubling it', () => {
    expect(escapeLike('100\\')).toBe('100\\\\');
  });

  it('returns empty string for empty input', () => {
    expect(escapeLike('')).toBe('');
  });

  it('escapes multiple wildcards in one string', () => {
    expect(escapeLike('a%b_c%d_')).toBe('a\\%b\\_c\\%d\\_');
  });

  it('escapes backslash BEFORE wildcards so chains do not double-escape', () => {
    // Si el orden fuera al revés, "\\%" terminaría como "\\\\%" (mal).
    // Confirmamos el resultado correcto: el backslash crudo se duplica, el % se prefija.
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });
});
