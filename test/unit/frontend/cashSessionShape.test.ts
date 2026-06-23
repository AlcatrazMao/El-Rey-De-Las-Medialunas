import { describe, it, expect } from 'vitest';

// Replica de validateCashSessionShape en
// apps/pos-pc/src/hooks/useCashSession.ts.
// Protege contra valores corruptos/maliciosos en localStorage antes de
// usarlos como CashSession en el estado de React.

interface CashSession {
  id: string;
  openedAt: string;
  initialAmount: number;
  expectedAmount: number;
  openedBy: string;
  status: 'open' | 'closed';
  [key: string]: unknown;
}

function validateCashSessionShape(raw: unknown): CashSession | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.trim() === '') return null;
  if (typeof obj.initialAmount !== 'number') return null;
  if (!Number.isFinite(obj.initialAmount)) return null;
  if (obj.initialAmount < 0) return null;
  if (typeof obj.openedAt !== 'string' || obj.openedAt.trim() === '') return null;
  return raw as CashSession;
}

const validSession = {
  id: 'cash_ses_1718000000000',
  openedAt: '2024-06-10T10:00:00.000Z',
  openedBy: 'Carlos',
  initialAmount: 1500,
  expectedAmount: 1500,
  status: 'open' as const,
};

describe('validateCashSessionShape', () => {
  it('objeto válido → retorna la sesión tipada', () => {
    const result = validateCashSessionShape(validSession);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(validSession.id);
    expect(result?.initialAmount).toBe(1500);
  });

  it('initialAmount: -1e10 → null (monto negativo rechazado)', () => {
    expect(validateCashSessionShape({ ...validSession, initialAmount: -1e10 })).toBeNull();
  });

  it('initialAmount: -0.01 → null (cualquier negativo rechazado)', () => {
    expect(validateCashSessionShape({ ...validSession, initialAmount: -0.01 })).toBeNull();
  });

  it('initialAmount: NaN → null', () => {
    expect(validateCashSessionShape({ ...validSession, initialAmount: NaN })).toBeNull();
  });

  it('initialAmount: Infinity → null', () => {
    expect(validateCashSessionShape({ ...validSession, initialAmount: Infinity })).toBeNull();
  });

  it('initialAmount: -Infinity → null', () => {
    expect(validateCashSessionShape({ ...validSession, initialAmount: -Infinity })).toBeNull();
  });

  it('initialAmount: 0 → válido (caja vacía es legítima)', () => {
    const result = validateCashSessionShape({ ...validSession, initialAmount: 0 });
    expect(result).not.toBeNull();
  });

  it('id: "" → null', () => {
    expect(validateCashSessionShape({ ...validSession, id: '' })).toBeNull();
  });

  it('id: "   " → null (solo espacios)', () => {
    expect(validateCashSessionShape({ ...validSession, id: '   ' })).toBeNull();
  });

  it('id: undefined → null', () => {
    const { id: _id, ...rest } = validSession;
    expect(validateCashSessionShape(rest)).toBeNull();
  });

  it('id: número → null', () => {
    expect(validateCashSessionShape({ ...validSession, id: 12345 })).toBeNull();
  });

  it('null → null', () => {
    expect(validateCashSessionShape(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(validateCashSessionShape(undefined)).toBeNull();
  });

  it('string JSON inválida → null', () => {
    expect(validateCashSessionShape('{"id":"x"}')).toBeNull();
  });

  it('número → null', () => {
    expect(validateCashSessionShape(42)).toBeNull();
  });

  it('array → null', () => {
    expect(validateCashSessionShape([validSession])).toBeNull();
  });

  it('sin openedAt → null', () => {
    const { openedAt: _oa, ...rest } = validSession;
    expect(validateCashSessionShape(rest)).toBeNull();
  });

  it('openedAt: "" → null', () => {
    expect(validateCashSessionShape({ ...validSession, openedAt: '' })).toBeNull();
  });

  it('openedAt: número → null', () => {
    expect(validateCashSessionShape({ ...validSession, openedAt: 1718000000000 })).toBeNull();
  });

  it('initialAmount: string numérico → null (no acepta coerción)', () => {
    expect(validateCashSessionShape({ ...validSession, initialAmount: '1500' })).toBeNull();
  });
});
