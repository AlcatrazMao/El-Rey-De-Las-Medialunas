import { describe, expect, it } from 'vitest';

import { PRODUCT_GROUP_LIMITS, validateGroupCommon } from '../routes/products';

const validBody = () => ({
  nombre: 'Docena',
  cantidad: 12,
  descuento: 10,
  descuento_tipo: 'porcentaje' as const,
  orden: 1 as const,
  admite_acum_desc: 0,
});

describe('validateGroupCommon — cantidad', () => {
  it('rechaza cantidad < 2', () => {
    const res = validateGroupCommon({ ...validBody(), cantidad: 1 }, true);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('VALIDATION_ERROR');
  });

  it('acepta cantidad = 2', () => {
    const res = validateGroupCommon({ ...validBody(), cantidad: 2 }, true);
    expect(res.ok).toBe(true);
  });

  it('rechaza cantidad no entera', () => {
    const res = validateGroupCommon({ ...validBody(), cantidad: 6.5 }, true);
    expect(res.ok).toBe(false);
  });

  it('rechaza cantidad superior al máximo (1000)', () => {
    const res = validateGroupCommon(
      { ...validBody(), cantidad: PRODUCT_GROUP_LIMITS.MAX_GROUP_CANTIDAD + 1 },
      true,
    );
    expect(res.ok).toBe(false);
  });

  it('rechaza cantidad no numérica', () => {
    const res = validateGroupCommon({ ...validBody(), cantidad: 'doce' as unknown as number }, true);
    expect(res.ok).toBe(false);
  });
});

describe('validateGroupCommon — orden', () => {
  it('rechaza orden 0 (fuera de {1,2,3})', () => {
    const res = validateGroupCommon({ ...validBody(), orden: 0 as unknown as 1 }, true);
    expect(res.ok).toBe(false);
  });

  it('rechaza orden 4 (fuera de {1,2,3})', () => {
    const res = validateGroupCommon({ ...validBody(), orden: 4 as unknown as 1 }, true);
    expect(res.ok).toBe(false);
  });

  it('acepta orden 1, 2 y 3', () => {
    for (const o of [1, 2, 3] as const) {
      const res = validateGroupCommon({ ...validBody(), orden: o }, true);
      expect(res.ok).toBe(true);
    }
  });
});

describe('validateGroupCommon — descuento_tipo', () => {
  it('rechaza descuento_tipo inválido', () => {
    const res = validateGroupCommon(
      { ...validBody(), descuento_tipo: 'flat' as unknown as 'porcentaje' },
      true,
    );
    expect(res.ok).toBe(false);
  });

  it('acepta "porcentaje" y "fijo"', () => {
    expect(validateGroupCommon({ ...validBody(), descuento_tipo: 'porcentaje' }, true).ok).toBe(true);
    expect(
      validateGroupCommon({ ...validBody(), descuento_tipo: 'fijo', descuento: 0 }, true).ok,
    ).toBe(true);
  });
});

describe('validateGroupCommon — descuento', () => {
  it('rechaza porcentaje > 100', () => {
    const res = validateGroupCommon(
      { ...validBody(), descuento_tipo: 'porcentaje', descuento: 101 },
      true,
    );
    expect(res.ok).toBe(false);
  });

  it('acepta porcentaje = 100', () => {
    const res = validateGroupCommon(
      { ...validBody(), descuento_tipo: 'porcentaje', descuento: 100 },
      true,
    );
    expect(res.ok).toBe(true);
  });

  it('rechaza fijo negativo', () => {
    const res = validateGroupCommon(
      { ...validBody(), descuento_tipo: 'fijo', descuento: -1 },
      true,
    );
    expect(res.ok).toBe(false);
  });

  it('rechaza descuento NaN', () => {
    const res = validateGroupCommon(
      { ...validBody(), descuento: Number.NaN },
      true,
    );
    expect(res.ok).toBe(false);
  });

  it('rechaza descuento Infinity', () => {
    const res = validateGroupCommon(
      { ...validBody(), descuento: Number.POSITIVE_INFINITY },
      true,
    );
    expect(res.ok).toBe(false);
  });
});

describe('validateGroupCommon — nombre', () => {
  it('rechaza nombre vacío', () => {
    const res = validateGroupCommon({ ...validBody(), nombre: '' }, true);
    expect(res.ok).toBe(false);
  });

  it('rechaza nombre solo whitespace', () => {
    const res = validateGroupCommon({ ...validBody(), nombre: '   ' }, true);
    expect(res.ok).toBe(false);
  });

  it(`rechaza nombre con más de ${PRODUCT_GROUP_LIMITS.MAX_GROUP_NAME_LEN} caracteres`, () => {
    const tooLong = 'a'.repeat(PRODUCT_GROUP_LIMITS.MAX_GROUP_NAME_LEN + 1);
    const res = validateGroupCommon({ ...validBody(), nombre: tooLong }, true);
    expect(res.ok).toBe(false);
  });

  it('acepta nombre justo en el límite', () => {
    const atLimit = 'a'.repeat(PRODUCT_GROUP_LIMITS.MAX_GROUP_NAME_LEN);
    const res = validateGroupCommon({ ...validBody(), nombre: atLimit }, true);
    expect(res.ok).toBe(true);
  });
});

describe('validateGroupCommon — admite_acum_desc', () => {
  it('acepta 0, 1, true, false y undefined', () => {
    expect(validateGroupCommon({ ...validBody(), admite_acum_desc: 0 }, true).ok).toBe(true);
    expect(validateGroupCommon({ ...validBody(), admite_acum_desc: 1 }, true).ok).toBe(true);
    expect(validateGroupCommon({ ...validBody(), admite_acum_desc: true }, true).ok).toBe(true);
    expect(validateGroupCommon({ ...validBody(), admite_acum_desc: false }, true).ok).toBe(true);
    const { admite_acum_desc: _omit, ...sinAdmite } = validBody();
    void _omit;
    expect(validateGroupCommon(sinAdmite, true).ok).toBe(true);
  });

  it('rechaza valores fuera de {0,1,true,false}', () => {
    const res = validateGroupCommon(
      { ...validBody(), admite_acum_desc: 2 as unknown as 0 | 1 },
      true,
    );
    expect(res.ok).toBe(false);
  });
});

describe('validateGroupCommon — modo parcial (requireAll=false)', () => {
  it('no exige nombre cuando requireAll=false', () => {
    const res = validateGroupCommon({ cantidad: 12, descuento: 10, descuento_tipo: 'porcentaje', orden: 1 }, false);
    expect(res.ok).toBe(true);
  });

  it('valida igual los campos provistos en modo parcial', () => {
    const res = validateGroupCommon({ cantidad: 1 }, false);
    expect(res.ok).toBe(false);
  });
});
