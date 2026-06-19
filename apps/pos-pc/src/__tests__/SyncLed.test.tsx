import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SyncLed } from '../components/SyncLed';
import type { SyncStatus } from '../types';

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    ledState: 'synced',
    pendingErrorCount: 0,
    isSyncing: false,
    isOnline: true,
    lastSync: null,
    ...overrides,
  };
}

describe('SyncLed', () => {
  it('renderiza en estado synced (verde)', () => {
    const html = renderToStaticMarkup(<SyncLed status={makeStatus({ ledState: 'synced' })} />);
    expect(html).toContain('data-state="synced"');
    expect(html.toLowerCase()).toContain('#22c55e');
  });

  it('renderiza en estado error (amarillo) y muestra contador', () => {
    const html = renderToStaticMarkup(
      <SyncLed status={makeStatus({ ledState: 'error', pendingErrorCount: 3 })} />
    );
    expect(html).toContain('data-state="error"');
    expect(html.toLowerCase()).toContain('#eab308');
    expect(html).toContain('>3<');
  });

  it('renderiza en estado offline (rojo)', () => {
    const html = renderToStaticMarkup(
      <SyncLed status={makeStatus({ ledState: 'offline', isOnline: false })} />
    );
    expect(html).toContain('data-state="offline"');
    expect(html.toLowerCase()).toContain('#ef4444');
  });

  it('expone tooltip via title y aria-label', () => {
    const html = renderToStaticMarkup(
      <SyncLed status={makeStatus({ ledState: 'error', pendingErrorCount: 2 })} />
    );
    expect(html).toMatch(/title="[^"]*2[^"]*"/);
    expect(html).toMatch(/aria-label="[^"]*"/);
  });

  it('muestra el ping de pulse cuando isSyncing', () => {
    const html = renderToStaticMarkup(
      <SyncLed status={makeStatus({ isSyncing: true })} />
    );
    expect(html).toContain('animate-ping');
  });
});
