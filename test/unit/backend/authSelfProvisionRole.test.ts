import { describe, expect, it } from 'vitest';

import { VALID_ROLES, isValidRole } from '../../../workers/api/src/routes/auth';

// Cubre la guard de auto-provisioning del POST /login: el rol debe venir del
// custom claim `role` del ID token y ser uno de los roles válidos. Nunca debe
// defaultearse (eso abriría auto-registro de atacantes como usuarios del POS).
describe('isValidRole — guard de auto-provisioning del login', () => {
  it('acepta todos los roles válidos del sistema', () => {
    for (const role of VALID_ROLES) {
      expect(isValidRole(role)).toBe(true);
    }
  });

  it('rechaza roles en español (legacy)', () => {
    expect(isValidRole('cajero')).toBe(false);
    expect(isValidRole('panadero')).toBe(false);
    expect(isValidRole('Administrador')).toBe(false);
  });

  it('rechaza valores no string', () => {
    expect(isValidRole(undefined)).toBe(false);
    expect(isValidRole(null)).toBe(false);
    expect(isValidRole(123)).toBe(false);
    expect(isValidRole({})).toBe(false);
    expect(isValidRole('')).toBe(false);
  });

  it('rechaza roles arbitrarios no pertenecientes al enum', () => {
    expect(isValidRole('superuser')).toBe(false);
    expect(isValidRole('root')).toBe(false);
    expect(isValidRole('admin ')).toBe(false); // sin trim implícito
  });
});
