import { describe, it, expect } from 'vitest';

import {
  MAX_NOTIFICATIONS,
  addNotification,
} from '../../../apps/pos-pc/src/hooks/useNotifications';

import type { PushNotification } from '../../../apps/pos-pc/src/types';

// ---------------------------------------------------------------------------
// Helper — genera una notificación mínima válida
// ---------------------------------------------------------------------------
function makeNotification(index: number): PushNotification {
  return {
    id: `not_${index}`,
    title: `Notificación ${index}`,
    message: `Mensaje ${index}`,
    type: 'info',
    timestamp: new Date(Date.now() + index).toISOString(),
    read: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MAX_NOTIFICATIONS', () => {
  it('es exactamente 50', () => {
    expect(MAX_NOTIFICATIONS).toBe(50);
  });
});

describe('addNotification (pure function)', () => {
  it('agrega una notificación a un array vacío', () => {
    const result = addNotification([], makeNotification(1));
    expect(result).toHaveLength(1);
  });

  it('la nueva notificación queda al inicio (newest-first)', () => {
    const existing = makeNotification(1);
    const newer = makeNotification(2);
    const result = addNotification([existing], newer);
    expect(result[0]).toBe(newer);
    expect(result[1]).toBe(existing);
  });

  it('no muta el array original', () => {
    const prev: PushNotification[] = [makeNotification(1)];
    const frozen = Object.freeze([...prev]);
    // Si addNotification muta prev, esto lanzaría en strict mode.
    const result = addNotification(frozen as PushNotification[], makeNotification(2));
    expect(result).not.toBe(frozen);
    expect(result).toHaveLength(2);
  });

  it('con 60 notificaciones el resultado tiene exactamente MAX_NOTIFICATIONS (50) elementos', () => {
    let notifications: PushNotification[] = [];
    for (let i = 1; i <= 60; i++) {
      notifications = addNotification(notifications, makeNotification(i));
    }
    expect(notifications).toHaveLength(MAX_NOTIFICATIONS);
  });

  it('las notificaciones más nuevas (últimas en agregarse) son las que permanecen', () => {
    let notifications: PushNotification[] = [];
    for (let i = 1; i <= 60; i++) {
      notifications = addNotification(notifications, makeNotification(i));
    }

    // La más nueva agregada fue makeNotification(60) → debe estar al índice 0.
    expect(notifications[0].id).toBe('not_60');

    // Las 50 más recientes son del 11 al 60 en orden descendente.
    // Índice 0 → not_60, índice 49 → not_11.
    expect(notifications[MAX_NOTIFICATIONS - 1].id).toBe('not_11');

    // Las primeras 10 (not_1 … not_10) deben haber sido descartadas.
    const ids = notifications.map(n => n.id);
    for (let i = 1; i <= 10; i++) {
      expect(ids).not.toContain(`not_${i}`);
    }
  });

  it('exactamente MAX_NOTIFICATIONS notificaciones no pierden ninguna', () => {
    let notifications: PushNotification[] = [];
    for (let i = 1; i <= MAX_NOTIFICATIONS; i++) {
      notifications = addNotification(notifications, makeNotification(i));
    }
    expect(notifications).toHaveLength(MAX_NOTIFICATIONS);
    // La primera (más vieja) debe seguir estando.
    const ids = notifications.map(n => n.id);
    expect(ids).toContain('not_1');
    expect(ids).toContain(`not_${MAX_NOTIFICATIONS}`);
  });

  it('agregar una más allá del cap descarta la más vieja (not_1)', () => {
    let notifications: PushNotification[] = [];
    for (let i = 1; i <= MAX_NOTIFICATIONS + 1; i++) {
      notifications = addNotification(notifications, makeNotification(i));
    }
    expect(notifications).toHaveLength(MAX_NOTIFICATIONS);
    const ids = notifications.map(n => n.id);
    expect(ids).not.toContain('not_1');
    expect(ids).toContain(`not_${MAX_NOTIFICATIONS + 1}`);
  });
});
