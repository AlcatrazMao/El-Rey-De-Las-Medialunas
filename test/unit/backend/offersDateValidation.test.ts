import { describe, expect, it } from 'vitest';

// Exact replica from workers/api/src/routes/offers.ts — validateOfferDates.
// Retorna null si OK, o el mensaje de error si la combinación es inválida.
function validateOfferDates(
  startsAt: string,
  endsAt: string | null | undefined,
): string | null {
  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(startMs)) {
    return 'starts_at no es una fecha válida';
  }
  if (endsAt !== null && endsAt !== undefined && endsAt !== '') {
    const endMs = Date.parse(endsAt);
    if (!Number.isFinite(endMs)) {
      return 'ends_at no es una fecha válida';
    }
    if (endMs <= startMs) {
      return 'ends_at debe ser posterior a starts_at';
    }
  }
  return null;
}

describe('validateOfferDates (offers.ts)', () => {
  it('returns null for a valid ISO starts_at and no ends_at', () => {
    expect(validateOfferDates('2026-06-21T10:00:00Z', undefined)).toBeNull();
  });

  it('returns null when ends_at is null', () => {
    expect(validateOfferDates('2026-06-21T10:00:00Z', null)).toBeNull();
  });

  it('returns null when ends_at is an empty string', () => {
    expect(validateOfferDates('2026-06-21T10:00:00Z', '')).toBeNull();
  });

  it('returns error for an unparseable starts_at', () => {
    expect(validateOfferDates('abc', undefined)).toMatch(/starts_at/);
  });

  it('returns error for an unparseable ends_at', () => {
    expect(validateOfferDates('2026-06-21T10:00:00Z', 'not-a-date')).toMatch(/ends_at/);
  });

  it('returns error when ends_at < starts_at', () => {
    expect(
      validateOfferDates('2026-06-21T10:00:00Z', '2026-06-20T10:00:00Z'),
    ).toMatch(/posterior/);
  });

  it('returns error when ends_at == starts_at (must be STRICTLY later)', () => {
    expect(
      validateOfferDates('2026-06-21T10:00:00Z', '2026-06-21T10:00:00Z'),
    ).toMatch(/posterior/);
  });

  it('returns null when ends_at > starts_at by one second', () => {
    expect(
      validateOfferDates('2026-06-21T10:00:00Z', '2026-06-21T10:00:01Z'),
    ).toBeNull();
  });

  it('returns null for bare YYYY-MM-DD dates with ends_at later', () => {
    expect(validateOfferDates('2026-06-21', '2026-06-22')).toBeNull();
  });
});
