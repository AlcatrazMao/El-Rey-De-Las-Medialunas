import { useState, useEffect, useCallback } from 'react';

import { INITIAL_NOTIFICATIONS } from '../initialData';
import type { PushNotification } from '../types';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

export const MAX_NOTIFICATIONS = 50;

// Pure function — exported for unit testing without React.
// Prepends a new notification and caps the array to MAX_NOTIFICATIONS,
// keeping the most recent entries (newest-first order).
export function addNotification(
  prev: PushNotification[],
  notification: PushNotification,
): PushNotification[] {
  return [notification, ...prev].slice(0, MAX_NOTIFICATIONS);
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<PushNotification[]>(() =>
    safeParseLocalStorage<PushNotification[]>('pan_erp_notifications', INITIAL_NOTIFICATIONS)
  );

  useEffect(() => {
    safeSetItem('pan_erp_notifications', JSON.stringify(notifications));
  }, [notifications]);

  const playAlertSound = (type: PushNotification['type']) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitAudioContext fallback for Safari
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'error') {
        // Red double beep
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
        setTimeout(() => {
          if (audioCtx.state === 'closed') return; // context was closed by a subsequent call
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.frequency.setValueAtTime(180, audioCtx.currentTime);
          gain2.gain.setValueAtTime(0.2, audioCtx.currentTime);
          osc2.start();
          osc2.stop(audioCtx.currentTime + 0.2);
        }, 200);
      } else if (type === 'warning') {
        // Flat warning beep
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } else if (type === 'success') {
        // Upward pleasant notification chime
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.stop(audioCtx.currentTime + 0.3);
        setTimeout(() => {
          if (audioCtx.state === 'closed') return; // context was closed by a subsequent call
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
          gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
          osc2.start();
          gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
          osc2.stop(audioCtx.currentTime + 0.35);
        }, 120);
      } else {
        // Subtle informative click
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
      }
      // Close AudioContext after sounds finish to prevent memory leak
      const maxDuration = type === 'error' ? 500 : type === 'success' ? 500 : 300;
      setTimeout(() => audioCtx.close(), maxDuration);
    } catch (e) {
      // Audio context issue (e.g. user hasn't interacted yet)
      // eslint-disable-next-line no-console -- expected when browser blocks audio
      console.log('Audio notification delayed due to browser interaction policies.');
    }
  };

  const addSystemNotification = useCallback((title: string, message: string, type: PushNotification['type']) => {
    const newNot: PushNotification = {
      id: `not_${Date.now()}`,
      title,
      message,
      type,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications(prev => addNotification(prev, newNot));
    playAlertSound(type);
  }, []);

  const markNotificationAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return { notifications, addSystemNotification, markNotificationAsRead, clearNotifications };
}
