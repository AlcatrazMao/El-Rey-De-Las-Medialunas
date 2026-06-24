import { describe, expect, it } from 'vitest';

/**
 * Tests para los fixes de backend R6b:
 *  - Fix 1: isValidDateInput (sales.ts GET /) — ISO 8601 estricto
 *  - Fix 3: canDeleteBranch — guard de sesiones abiertas (lógica pura)
 */

// ── Fix 1: isValidDateInput ─────────────────────────────────────────────────
// Réplica exacta de la función en workers/api/src/routes/sales.ts
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
function isValidDateInput(s: string): boolean {
  return ISO_DATE_RE.test(s);
}

describe('isValidDateInput (sales.ts)', () => {
  // Casos válidos — bareDate
  it('acepta YYYY-MM-DD (bareDate)', () => {
    expect(isValidDateInput('2026-06-19')).toBe(true);
  });

  // Casos válidos — ISO 8601 completo
  it('acepta ISO 8601 con Z (UTC)', () => {
    expect(isValidDateInput('2026-06-19T15:00:00Z')).toBe(true);
  });

  it('acepta ISO 8601 con offset positivo', () => {
    expect(isValidDateInput('2026-06-19T12:00:00+03:00')).toBe(true);
  });

  it('acepta ISO 8601 con offset negativo', () => {
    expect(isValidDateInput('2026-06-19T03:00:00-03:00')).toBe(true);
  });

  it('acepta ISO 8601 sin timezone (datetime local)', () => {
    expect(isValidDateInput('2026-06-19T15:00:00')).toBe(true);
  });

  it('acepta ISO 8601 con milisegundos y Z', () => {
    expect(isValidDateInput('2026-06-19T03:00:00.000Z')).toBe(true);
  });

  it('acepta ISO 8601 solo con horas y minutos', () => {
    expect(isValidDateInput('2026-06-19T15:00')).toBe(true);
  });

  // Casos inválidos — el bug original: espacio como separador
  it('rechaza espacio como separador (2026-06-19 15:00)', () => {
    expect(isValidDateInput('2026-06-19 15:00')).toBe(false);
  });

  it('rechaza espacio con segundos (2026-06-19 15:00:00)', () => {
    expect(isValidDateInput('2026-06-19 15:00:00')).toBe(false);
  });

  // Otros casos inválidos
  it('rechaza string arbitrario', () => {
    expect(isValidDateInput('hoy')).toBe(false);
  });

  it('rechaza string vacío', () => {
    expect(isValidDateInput('')).toBe(false);
  });

  it('rechaza fecha con formato DD/MM/YYYY', () => {
    expect(isValidDateInput('19/06/2026')).toBe(false);
  });

  it('rechaza solo hora sin fecha', () => {
    expect(isValidDateInput('T15:00:00Z')).toBe(false);
  });

  it('rechaza timestamp Unix (número)', () => {
    expect(isValidDateInput('1718800000')).toBe(false);
  });
});

// ── Fix 3: canDeleteBranch ──────────────────────────────────────────────────
// Réplica de la lógica pura del guard en workers/api/src/routes/branches.ts
// DELETE handler: si openSessionCount > 0 → rechazar con 409.
function canDeleteBranch(openSessionCount: number): { allowed: boolean; reason?: string } {
  if (openSessionCount > 0) {
    return {
      allowed: false,
      reason: 'La sucursal tiene sesiones de caja abiertas. Cerralas antes de eliminarla.',
    };
  }
  return { allowed: true };
}

describe('canDeleteBranch — guard de sesiones abiertas', () => {
  it('permite eliminar cuando no hay sesiones abiertas (count = 0)', () => {
    const result = canDeleteBranch(0);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('bloquea eliminar cuando hay 1 sesión abierta', () => {
    const result = canDeleteBranch(1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sesiones de caja abiertas');
  });

  it('bloquea eliminar cuando hay múltiples sesiones abiertas', () => {
    const result = canDeleteBranch(5);
    expect(result.allowed).toBe(false);
  });

  it('el mensaje de razón indica cómo resolver el conflicto', () => {
    const result = canDeleteBranch(2);
    expect(result.reason).toContain('Cerralas antes');
  });
});
