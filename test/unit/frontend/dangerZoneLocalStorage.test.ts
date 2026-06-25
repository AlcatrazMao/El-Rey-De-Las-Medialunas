import { describe, it, expect, beforeEach } from 'vitest';

// Exact replica from apps/pos-pc/src/settings/DangerZoneSettings.tsx

const PRESERVED_KEYS = new Set(['pan_erp_settings']);

function isPreservedKey(key: string): boolean {
  if (PRESERVED_KEYS.has(key)) return true;
  if (key.startsWith('pan_erp_widgets_')) return true;
  return false;
}

function wipeLocalStorage(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('pan_erp_') && !isPreservedKey(key)) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}

describe('dangerZone localStorage wipe', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('isPreservedKey', () => {
    it('preserves pan_erp_settings', () => {
      expect(isPreservedKey('pan_erp_settings')).toBe(true);
    });

    it('preserves pan_erp_widgets_abc123', () => {
      expect(isPreservedKey('pan_erp_widgets_abc123')).toBe(true);
    });

    it('preserves pan_erp_widgets_ (solo prefijo)', () => {
      expect(isPreservedKey('pan_erp_widgets_')).toBe(true);
    });

    it('does NOT preserve pan_erp_users', () => {
      expect(isPreservedKey('pan_erp_users')).toBe(false);
    });

    it('does NOT preserve pan_erp_active_user_id', () => {
      expect(isPreservedKey('pan_erp_active_user_id')).toBe(false);
    });

    it('does NOT preserve other_key', () => {
      expect(isPreservedKey('other_key')).toBe(false);
    });
  });

  describe('wipeLocalStorage', () => {
    beforeEach(() => {
      localStorage.setItem('pan_erp_settings', 'settings-value');
      localStorage.setItem('pan_erp_widgets_home', 'widget-home');
      localStorage.setItem('pan_erp_widgets_pos', 'widget-pos');
      localStorage.setItem('pan_erp_users', 'users-data');
      localStorage.setItem('pan_erp_active_user_id', 'user-123');
      localStorage.setItem('pan_erp_sales', 'sales-data');
      localStorage.setItem('unrelated_key', 'unrelated-value');
    });

    it('removes non-preserved pan_erp_* keys', () => {
      wipeLocalStorage();
      expect(localStorage.getItem('pan_erp_users')).toBeNull();
      expect(localStorage.getItem('pan_erp_active_user_id')).toBeNull();
      expect(localStorage.getItem('pan_erp_sales')).toBeNull();
    });

    it('keeps pan_erp_settings intact', () => {
      wipeLocalStorage();
      expect(localStorage.getItem('pan_erp_settings')).toBe('settings-value');
    });

    it('keeps pan_erp_widgets_* intact', () => {
      wipeLocalStorage();
      expect(localStorage.getItem('pan_erp_widgets_home')).toBe('widget-home');
      expect(localStorage.getItem('pan_erp_widgets_pos')).toBe('widget-pos');
    });

    it('does not touch keys that do not start with pan_erp_', () => {
      wipeLocalStorage();
      expect(localStorage.getItem('unrelated_key')).toBe('unrelated-value');
    });

    it('does nothing when there are no pan_erp_* keys', () => {
      localStorage.clear();
      localStorage.setItem('other', 'data');
      wipeLocalStorage();
      expect(localStorage.getItem('other')).toBe('data');
    });
  });
});
