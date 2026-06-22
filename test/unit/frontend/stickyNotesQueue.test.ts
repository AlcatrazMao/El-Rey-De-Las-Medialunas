import { describe, it, expect, beforeEach } from 'vitest';

import {
  drainQueuedNotes,
  buildStickyFromQueued,
  addAutoNote,
  type StickyNote,
  type QueuedNote,
} from '../../../apps/pos-pc/src/hooks/useStickyNotes';

const QUEUE_KEY = 'pan_erp_notes_queue';

// Helper que reproduce el cuerpo del listener del hook (sin React) para
// validar el drenado idempotente en distintos escenarios.
function simulateDrainIntoState(currentNotes: StickyNote[]): StickyNote[] {
  const queue = drainQueuedNotes();
  let next = currentNotes;
  queue.forEach((item, i) => {
    if (next.some(n => n.title === item.title && n.content === item.content)) return;
    const newNote = buildStickyFromQueued(item, next.length + i);
    next = [newNote, ...next];
  });
  return next;
}

describe('drainQueuedNotes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('queue inexistente → []', () => {
    expect(drainQueuedNotes()).toEqual([]);
  });

  it('queue vacío → []', () => {
    localStorage.setItem(QUEUE_KEY, '[]');
    expect(drainQueuedNotes()).toEqual([]);
    // Pero igual lo limpia (defensivo)
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('queue con 1 nota → la devuelve y vacía localStorage', () => {
    const note: QueuedNote = {
      title: 'X',
      content: 'Y',
      category: 'general',
      priority: 'low',
    };
    localStorage.setItem(QUEUE_KEY, JSON.stringify([note]));

    const result = drainQueuedNotes();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'X', content: 'Y', category: 'general', priority: 'low' });
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('JSON corrupto → [] sin lanzar', () => {
    localStorage.setItem(QUEUE_KEY, '{not-json');
    expect(drainQueuedNotes()).toEqual([]);
  });

  it('payload no-array → [] + limpia el slot', () => {
    localStorage.setItem(QUEUE_KEY, '{"foo": "bar"}');
    expect(drainQueuedNotes()).toEqual([]);
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('filtra items malformados del array', () => {
    const valid: QueuedNote = {
      title: 'ok', content: 'ok', category: 'tarea', priority: 'medium',
    };
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      valid,
      { title: 'falta-resto' },
      null,
      'string-suelta',
    ]));
    const result = drainQueuedNotes();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('ok');
  });
});

describe('simulateDrainIntoState (lógica del hook sin React)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('queue vacío al montar → state sin cambios', () => {
    const initial: StickyNote[] = [];
    const next = simulateDrainIntoState(initial);
    expect(next).toEqual([]);
  });

  it('queue con 1 nota al montar → la nota se agrega y el queue queda vacío', () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { title: 'A', content: 'a', category: 'general', priority: 'low' },
    ]));

    const next = simulateDrainIntoState([]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ title: 'A', content: 'a' });
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('queue con 3 notas → las 3 se procesan en orden', () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { title: 'A', content: '1', category: 'general', priority: 'low' },
      { title: 'B', content: '2', category: 'ventas', priority: 'medium' },
      { title: 'C', content: '3', category: 'caja', priority: 'high' },
    ]));

    const next = simulateDrainIntoState([]);
    // Cada nueva se inserta al inicio → orden final inverso al orden del queue.
    expect(next.map(n => n.title)).toEqual(['C', 'B', 'A']);
  });

  it('CustomEvent llega después del mount → drenado posterior también funciona', () => {
    // Estado inicial: drenado vacío
    let state = simulateDrainIntoState([]);
    expect(state).toEqual([]);

    // addAutoNote despachado mientras el hook ya estaba montado pero el
    // listener pudo no estar atado en frame 0 → la nota igual quedó en queue.
    addAutoNote('post-mount', 'hola', 'general', 'medium');
    // Verificá que addAutoNote dejó la entrada en queue:
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toHaveLength(1);

    // El listener del hook reacciona al evento llamando drainQueueIntoState():
    state = simulateDrainIntoState(state);
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ title: 'post-mount', content: 'hola' });
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('dos drenados consecutivos no duplican notas (idempotencia)', () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { title: 'A', content: 'a', category: 'general', priority: 'low' },
    ]));

    const first = simulateDrainIntoState([]);
    expect(first).toHaveLength(1);

    // Segundo drenado sin nuevas notas — queue ya está vacío.
    const second = simulateDrainIntoState(first);
    expect(second).toHaveLength(1);
    expect(second).toBe(first); // misma referencia → no se mutó
  });

  it('deduplica por título+contenido entre queue y state existente', () => {
    // Caso del race: la nota llegó vía evento (ya está en state) y también
    // está en el queue persistido. El drenado no debe duplicar.
    const existing: StickyNote = buildStickyFromQueued(
      { title: 'X', content: 'y', category: 'general', priority: 'low' },
      0,
    );
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { title: 'X', content: 'y', category: 'general', priority: 'low' },
    ]));

    const next = simulateDrainIntoState([existing]);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(existing);
  });
});

describe('addAutoNote (queue persistence)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('agrega entrada al queue de localStorage', () => {
    addAutoNote('título', 'cuerpo', 'tarea', 'high');
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      title: 'título',
      content: 'cuerpo',
      category: 'tarea',
      priority: 'high',
    });
    expect(queue[0].queuedAt).toBeTruthy();
  });

  it('agrega múltiples notas al queue sin pisar las anteriores', () => {
    addAutoNote('a', '1', 'general', 'low');
    addAutoNote('b', '2', 'ventas', 'medium');
    addAutoNote('c', '3', 'caja', 'high');
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    expect(queue).toHaveLength(3);
    expect(queue.map((q: QueuedNote) => q.title)).toEqual(['a', 'b', 'c']);
  });

  it('despacha CustomEvent sticky-note-add', () => {
    let received: StickyNote | null = null;
    const listener = (e: Event) => {
      received = (e as CustomEvent<StickyNote>).detail;
    };
    window.addEventListener('sticky-note-add', listener);
    addAutoNote('evt-title', 'evt-content', 'inventario', 'medium');
    window.removeEventListener('sticky-note-add', listener);

    expect(received).not.toBeNull();
    expect(received).toMatchObject({
      title: 'evt-title',
      content: 'evt-content',
      category: 'inventario',
      priority: 'medium',
    });
  });
});
