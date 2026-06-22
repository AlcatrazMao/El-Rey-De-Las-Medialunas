import { describe, expect, it } from 'vitest';

import { escapeLike } from '../../../workers/api/src/lib/sql-escape';

describe('escapeLike (lib/sql-escape)', () => {
  it('deja un string sin caracteres especiales sin cambios', () => {
    expect(escapeLike('medialunas')).toBe('medialunas');
  });

  it('retorna string vacío para entrada vacía', () => {
    expect(escapeLike('')).toBe('');
  });

  it('escapa el carácter %', () => {
    expect(escapeLike('50%')).toBe('50\\%');
  });

  it('escapa el carácter _', () => {
    expect(escapeLike('pan_dulce')).toBe('pan\\_dulce');
  });

  it('escapa backslash duplicándolo', () => {
    expect(escapeLike('C:\\path')).toBe('C:\\\\path');
  });

  it('escapa múltiples wildcards en un solo string', () => {
    expect(escapeLike('a%b_c')).toBe('a\\%b\\_c');
  });

  it('escapa backslash ANTES que los wildcards para evitar doble-escape', () => {
    // "\\%" → primero el backslash se duplica → "\\\\" + "%" → luego el % se escapa
    // resultado: "\\\\\\%" (el backslash queda como \\\\ y el % como \\%)
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('escapa underscore al inicio y al final', () => {
    expect(escapeLike('_inicio_fin_')).toBe('\\_inicio\\_fin\\_');
  });
});
