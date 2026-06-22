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

// Imita lo que hace useCustomers al normalizar tipos de D1 (passthrough cuando
// no hay match — preferimos mostrar el valor crudo a romper la UI con undefined).
function normalizeBackendType(raw: string): string {
  return backendToLocalType[raw] ?? raw;
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
