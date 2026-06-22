import { describe, expect, it } from 'vitest';

// Réplica de la lógica de rate-limit de uploads.ts.
// Valida: cálculo de segundos restantes y que Retry-After sea un entero positivo.

const UPLOAD_RATE_LIMIT = 30;
const UPLOAD_RATE_WINDOW_S = 3600;

interface RlEntry {
  count: number;
  resetAt: number; // epoch seconds
}

/**
 * Simula la lógica de rate-limit de uploads.ts.
 * Devuelve { limited: false } si aún hay cupo, o
 * { limited: true, retryAfter } si se superó el límite.
 */
function checkRateLimit(
  raw: string | null,
  nowEpoch: number,
): { limited: false; entry: RlEntry } | { limited: true; retryAfter: number } {
  let entry: RlEntry = { count: 0, resetAt: nowEpoch + UPLOAD_RATE_WINDOW_S };

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RlEntry;
      if (nowEpoch < parsed.resetAt) {
        entry = parsed;
      }
      // Si resetAt ya pasó, reiniciar (entry ya tiene los defaults)
    } catch {
      // JSON inválido → entrada fresca
    }
  }

  if (entry.count >= UPLOAD_RATE_LIMIT) {
    const retryAfter = Math.max(1, entry.resetAt - nowEpoch);
    return { limited: true, retryAfter };
  }

  entry.count += 1;
  return { limited: false, entry };
}

describe('uploads — rate-limit por usuario', () => {
  const NOW = 1_700_000_000; // epoch fijo para tests

  it('permite el primer upload (sin entrada previa en KV)', () => {
    const result = checkRateLimit(null, NOW);
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.entry.count).toBe(1);
      expect(result.entry.resetAt).toBe(NOW + UPLOAD_RATE_WINDOW_S);
    }
  });

  it('permite el upload número 30 (límite exacto aún no superado)', () => {
    const entry: RlEntry = { count: 29, resetAt: NOW + 3000 };
    const result = checkRateLimit(JSON.stringify(entry), NOW);
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.entry.count).toBe(30);
    }
  });

  it('bloquea el upload número 31 y retorna retryAfter positivo', () => {
    const entry: RlEntry = { count: 30, resetAt: NOW + 1800 };
    const result = checkRateLimit(JSON.stringify(entry), NOW);
    expect(result.limited).toBe(true);
    if (result.limited) {
      expect(result.retryAfter).toBe(1800);
      expect(result.retryAfter).toBeGreaterThan(0);
    }
  });

  it('retryAfter es al menos 1 cuando la ventana está por expirar', () => {
    // resetAt exactamente igual a now → Math.max(1, 0) = 1
    const entry: RlEntry = { count: 30, resetAt: NOW };
    const result = checkRateLimit(JSON.stringify(entry), NOW);
    expect(result.limited).toBe(true);
    if (result.limited) {
      expect(result.retryAfter).toBe(1);
      expect(typeof result.retryAfter).toBe('number');
    }
  });

  it('reinicia el contador cuando la ventana ya expiró', () => {
    // resetAt en el pasado → la entrada se descarta y se crea una nueva
    const expired: RlEntry = { count: 30, resetAt: NOW - 1 };
    const result = checkRateLimit(JSON.stringify(expired), NOW);
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.entry.count).toBe(1);
      expect(result.entry.resetAt).toBe(NOW + UPLOAD_RATE_WINDOW_S);
    }
  });

  it('trata JSON inválido en KV como entrada fresca', () => {
    const result = checkRateLimit('no-es-json', NOW);
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.entry.count).toBe(1);
    }
  });

  it('retryAfter es un número positivo (siempre), validación de header', () => {
    const entry: RlEntry = { count: 30, resetAt: NOW + 2700 };
    const result = checkRateLimit(JSON.stringify(entry), NOW);
    expect(result.limited).toBe(true);
    if (result.limited) {
      // El header Retry-After debe ser string de número positivo
      const headerValue = String(result.retryAfter);
      expect(Number(headerValue)).toBeGreaterThan(0);
      expect(Number.isInteger(Number(headerValue))).toBe(true);
    }
  });
});
