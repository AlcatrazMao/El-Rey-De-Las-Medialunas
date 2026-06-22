import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Replica de la lógica de detección de "día anterior en ARG" implementada en
// apps/pos-pc/src/hooks/useCashSession.ts. Comparamos fechas en UTC-3 para
// alinearnos con el backend (cash.ts hace DATE(opened_at, '-3 hours')).
// Si comparáramos contra new Date() y el navegador estuviese en otra TZ,
// el auto-cierre se dispararía en momentos incorrectos respecto al día
// contable ARG.
const ARG_OFFSET_MS = 3 * 60 * 60 * 1000;

function isFromPreviousDayInArg(openedAtISO: string, nowMs: number = Date.now()): boolean {
  const nowArg = new Date(nowMs - ARG_OFFSET_MS);
  const todayArg = nowArg.toISOString().split('T')[0];

  const openedArg = new Date(new Date(openedAtISO).getTime() - ARG_OFFSET_MS);
  const openedDayArg = openedArg.toISOString().split('T')[0];

  return openedDayArg < todayArg;
}

describe('isFromPreviousDayInArg (useCashSession)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sesión abierta hoy en ARG → NO debe cerrarse', () => {
    // "Ahora" = 2026-06-21 15:00 UTC = 2026-06-21 12:00 ARG
    vi.setSystemTime(new Date('2026-06-21T15:00:00Z'));
    // Apertura: 2026-06-21 13:00 UTC = 2026-06-21 10:00 ARG → mismo día
    const opened = '2026-06-21T13:00:00Z';
    expect(isFromPreviousDayInArg(opened)).toBe(false);
  });

  it('sesión abierta ayer en ARG → DEBE cerrarse', () => {
    // "Ahora" = 2026-06-21 15:00 UTC = 2026-06-21 12:00 ARG
    vi.setSystemTime(new Date('2026-06-21T15:00:00Z'));
    // Apertura: 2026-06-20 15:00 UTC = 2026-06-20 12:00 ARG → día anterior
    const opened = '2026-06-20T15:00:00Z';
    expect(isFromPreviousDayInArg(opened)).toBe(true);
  });

  it('sesión a las 01:00 UTC (= 22:00 ARG día anterior) se trata como día anterior en ARG', () => {
    // "Ahora" = 2026-06-21 15:00 UTC = 2026-06-21 12:00 ARG
    vi.setSystemTime(new Date('2026-06-21T15:00:00Z'));
    // Apertura: 2026-06-21 01:00 UTC = 2026-06-20 22:00 ARG
    // En tiempo UTC parece "hoy", pero en ARG es ayer y DEBE cerrarse.
    const opened = '2026-06-21T01:00:00Z';
    expect(isFromPreviousDayInArg(opened)).toBe(true);
  });

  it('sesión apenas pasada la medianoche ARG (03:01 UTC) → mismo día ARG, no cerrar', () => {
    // "Ahora" = 2026-06-21 15:00 UTC = 2026-06-21 12:00 ARG
    vi.setSystemTime(new Date('2026-06-21T15:00:00Z'));
    // 2026-06-21 03:01 UTC = 2026-06-21 00:01 ARG → mismo día ARG
    const opened = '2026-06-21T03:01:00Z';
    expect(isFromPreviousDayInArg(opened)).toBe(false);
  });

  it('sesión justo antes de medianoche ARG (02:59 UTC) → día anterior ARG, cerrar', () => {
    // "Ahora" = 2026-06-21 15:00 UTC = 2026-06-21 12:00 ARG
    vi.setSystemTime(new Date('2026-06-21T15:00:00Z'));
    // 2026-06-21 02:59 UTC = 2026-06-20 23:59 ARG → día anterior
    const opened = '2026-06-21T02:59:00Z';
    expect(isFromPreviousDayInArg(opened)).toBe(true);
  });
});
