import { describe, expect, it } from 'vitest';

/**
 * Tests para los fixes de frontend R6b:
 *  - Fix 6: loadMoreSessionsCursor — cursor por openedAt en vez de id
 */

// Tipo mínimo que replica los campos relevantes de CashSession usados en
// loadMoreSessions (useCashSession.ts).
interface MinimalSession {
  id: string;
  openedAt: string;
}

// Réplica exacta de la lógica del cursor en loadMoreSessions (post-fix).
// Calcula el openedAt de la sesión más antigua para usarlo como before_id.
function computeCursorByOpenedAt(sessions: MinimalSession[]): string | undefined {
  if (sessions.length === 0) return undefined;
  const oldest = sessions.reduce(
    (prev, s) => (s.openedAt < prev.openedAt ? s : prev),
    sessions[0],
  );
  return oldest.openedAt;
}

describe('loadMoreSessionsCursor — cursor por openedAt (Fix 6)', () => {
  it('retorna undefined para historial vacío', () => {
    expect(computeCursorByOpenedAt([])).toBeUndefined();
  });

  it('retorna el openedAt de la única sesión si hay solo una', () => {
    const sessions: MinimalSession[] = [
      { id: 'cash_ses_1719000000000', openedAt: '2026-06-21T10:00:00.000Z' },
    ];
    expect(computeCursorByOpenedAt(sessions)).toBe('2026-06-21T10:00:00.000Z');
  });

  it('retorna el openedAt más antiguo con sesiones homogéneas (IDs locales)', () => {
    const sessions: MinimalSession[] = [
      { id: 'cash_ses_1719100000000', openedAt: '2026-06-22T09:00:00.000Z' },
      { id: 'cash_ses_1719000000000', openedAt: '2026-06-21T10:00:00.000Z' }, // oldest
      { id: 'cash_ses_1719200000000', openedAt: '2026-06-23T08:00:00.000Z' },
    ];
    expect(computeCursorByOpenedAt(sessions)).toBe('2026-06-21T10:00:00.000Z');
  });

  it('retorna el openedAt más antiguo con IDs mixtos (local + backend UUID hex)', () => {
    // El bug original: mezclar 'cash_ses_*' (string largo) con UUIDs hex
    // hace que el min por id sea el UUID hex (empieza con dígitos bajos),
    // apuntando a la sesión EQUIVOCADA. Con openedAt el resultado es correcto.
    const sessions: MinimalSession[] = [
      { id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', openedAt: '2026-06-23T08:00:00.000Z' }, // backend UUID, openedAt newest
      { id: 'cash_ses_1719000000000',            openedAt: '2026-06-21T10:00:00.000Z' }, // local, openedAt oldest
      { id: '0000aabbccddeeff0011223344556677', openedAt: '2026-06-22T09:00:00.000Z' }, // backend UUID con id "pequeño"
    ];
    // El id más pequeño lex sería '0000aabb...' (backend), que corresponde a
    // openedAt 2026-06-22 — NO la sesión más antigua.
    // El cursor correcto es openedAt 2026-06-21 (cash_ses_1719000000000).
    expect(computeCursorByOpenedAt(sessions)).toBe('2026-06-21T10:00:00.000Z');
  });

  it('con IDs mixtos — el cursor por id-mínimo sería incorrecto', () => {
    // Verificamos explícitamente que el cursor por id hubiera dado el resultado
    // equivocado, confirmando por qué el fix era necesario.
    const sessions: MinimalSession[] = [
      { id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', openedAt: '2026-06-23T08:00:00.000Z' },
      { id: 'cash_ses_1719000000000',            openedAt: '2026-06-21T10:00:00.000Z' },
      { id: '0000aabbccddeeff0011223344556677', openedAt: '2026-06-22T09:00:00.000Z' },
    ];
    // Lógica pre-fix (buggy): min por id
    const buggyMinId = sessions.reduce(
      (min, s) => (s.id < min ? s.id : min),
      sessions[0].id,
    );
    // '0000...' < 'a1b2...' < 'cash_ses_...' → min es '0000...'
    expect(buggyMinId).toBe('0000aabbccddeeff0011223344556677');
    // Que corresponde a openedAt 2026-06-22 — NO la más antigua
    const buggySession = sessions.find(s => s.id === buggyMinId);
    expect(buggySession?.openedAt).toBe('2026-06-22T09:00:00.000Z');
    // Mientras que el fix devuelve la correcta: 2026-06-21
    expect(computeCursorByOpenedAt(sessions)).toBe('2026-06-21T10:00:00.000Z');
  });

  it('maneja sesiones en el mismo día — elige la de menor hora', () => {
    const sessions: MinimalSession[] = [
      { id: 'sess_1', openedAt: '2026-06-21T14:00:00.000Z' },
      { id: 'sess_2', openedAt: '2026-06-21T08:00:00.000Z' }, // más antigua
      { id: 'sess_3', openedAt: '2026-06-21T11:30:00.000Z' },
    ];
    expect(computeCursorByOpenedAt(sessions)).toBe('2026-06-21T08:00:00.000Z');
  });
});
