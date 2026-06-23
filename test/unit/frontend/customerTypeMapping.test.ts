import { describe, it, expect } from 'vitest';

// Replica exacta del mapping declarado en
// apps/pos-pc/src/hooks/useCustomers.ts. Si el backend agrega una nueva
// categoría hay que sincronizar ambos lugares — este test sirve de espec
// ejecutable de la traducción inglés→castellano que renderiza la UI.
type LocalCustomerType = 'consumidor_final' | 'mayorista' | 'frecuente' | 'empresa';

const backendToLocalType: Record<string, LocalCustomerType> = {
  consumer: 'consumidor_final',
  wholesale: 'mayorista',
  frequent: 'frecuente',
  corporate: 'empresa',
};

// Inverse map: local (Spanish UI) → backend (English API).
// Exported from useCustomers.ts as localToBackendType.
const localToBackendType: Record<string, string> = {
  consumidor_final: 'consumer',
  mayorista: 'wholesale',
  frecuente: 'frequent',
  empresa: 'corporate',
};

// Imita lo que hace useCustomers al normalizar tipos de D1 (passthrough cuando
// no hay match — preferimos mostrar el valor crudo a romper la UI con undefined).
function normalizeBackendType(raw: string): string {
  return backendToLocalType[raw] ?? raw;
}

// Imita lo que hace updateCustomer antes de enviar al backend.
function toBackendType(local: string): string {
  return localToBackendType[local] ?? local;
}

describe('backendToLocalType (useCustomers)', () => {
  it('consumer → consumidor_final', () => {
    expect(normalizeBackendType('consumer')).toBe('consumidor_final');
  });

  it('wholesale → mayorista', () => {
    expect(normalizeBackendType('wholesale')).toBe('mayorista');
  });

  it('frequent → frecuente', () => {
    expect(normalizeBackendType('frequent')).toBe('frecuente');
  });

  it('corporate → empresa', () => {
    expect(normalizeBackendType('corporate')).toBe('empresa');
  });

  it('valor desconocido → passthrough (retorna el mismo valor)', () => {
    expect(normalizeBackendType('unknown')).toBe('unknown');
  });

  it('valor vacío → passthrough', () => {
    expect(normalizeBackendType('')).toBe('');
  });

  it('passthrough no rompe si llega ya traducido (regresión defensiva)', () => {
    // El backend nunca debería mandar la variante local, pero si pasara, la
    // UI no debe quedar en blanco — el valor pasa intacto.
    expect(normalizeBackendType('consumidor_final')).toBe('consumidor_final');
  });
});

describe('localToBackendType (useCustomers.updateCustomer)', () => {
  it('"consumidor_final" → "consumer"', () => {
    expect(toBackendType('consumidor_final')).toBe('consumer');
  });

  it('"mayorista" → "wholesale"', () => {
    expect(toBackendType('mayorista')).toBe('wholesale');
  });

  it('"frecuente" → "frequent"', () => {
    expect(toBackendType('frecuente')).toBe('frequent');
  });

  it('"empresa" → "corporate"', () => {
    expect(toBackendType('empresa')).toBe('corporate');
  });

  it('valor desconocido → passthrough (no bloquea el update)', () => {
    expect(toBackendType('otro')).toBe('otro');
  });
});

describe('round-trip: backend → local → backend', () => {
  const backendValues = ['consumer', 'wholesale', 'frequent', 'corporate'] as const;

  for (const backendVal of backendValues) {
    it(`"${backendVal}" survives the round-trip`, () => {
      const local = normalizeBackendType(backendVal);
      const backAgain = toBackendType(local);
      expect(backAgain).toBe(backendVal);
    });
  }
});
