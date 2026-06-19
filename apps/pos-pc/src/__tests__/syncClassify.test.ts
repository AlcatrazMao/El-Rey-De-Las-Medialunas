import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyError } from '../services/d1-sync';

describe('classifyError', () => {
  const originalOnLine = globalThis.navigator?.onLine;

  beforeEach(() => {
    // Default: navigator.onLine = true
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: originalOnLine,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('clasifica como network cuando navigator.onLine === false', () => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });
    expect(classifyError(new Error('boom'))).toBe('network');
  });

  it('clasifica como network un TypeError de fetch', () => {
    const err = new TypeError('Failed to fetch');
    expect(classifyError(err)).toBe('network');
  });

  it('clasifica como network un TypeError de network', () => {
    const err = new TypeError('NetworkError when attempting to fetch resource');
    expect(classifyError(err)).toBe('network');
  });

  it('clasifica como auth con status 401', () => {
    const response = { status: 401 } as Response;
    expect(classifyError(new Error('Unauthorized'), response)).toBe('auth');
  });

  it('clasifica como auth con status 403', () => {
    const response = { status: 403 } as Response;
    expect(classifyError(new Error('Forbidden'), response)).toBe('auth');
  });

  it('clasifica como validation con status 400', () => {
    const response = { status: 400 } as Response;
    expect(classifyError(new Error('Bad Request'), response)).toBe('validation');
  });

  it('clasifica como validation con status 422', () => {
    const response = { status: 422 } as Response;
    expect(classifyError(new Error('Unprocessable Entity'), response)).toBe('validation');
  });

  it('clasifica como server con status 500', () => {
    const response = { status: 500 } as Response;
    expect(classifyError(new Error('Internal Server Error'), response)).toBe('server');
  });
});
