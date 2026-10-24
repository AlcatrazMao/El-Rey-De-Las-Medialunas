import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(resolve('apps/pos-pc/package.json'));
const { createElement, act } = require('react');
const { createRoot } = require('react-dom/client');

import { NotesCanvas } from '../../../apps/pos-pc/src/components/NotesCanvas';

describe('NotesCanvas: Pantalla completa y rotación horizontal', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let requestFullscreenMock: ReturnType<typeof vi.fn>;
  let exitFullscreenMock: ReturnType<typeof vi.fn>;
  let orientationLockMock: ReturnType<typeof vi.fn>;
  let orientationUnlockMock: ReturnType<typeof vi.fn>;

  const mockNotes = [
    {
      id: 'n1',
      title: 'Nota de prueba',
      content: 'Contenido canvas',
      x: 10,
      y: 20,
      width: 200,
      color: '#FEF08A',
      status: 'active' as const,
      category: 'general' as const,
      priority: 'medium' as const,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
    orientationLockMock = vi.fn().mockResolvedValue(undefined);
    orientationUnlockMock = vi.fn();

    // Mock Fullscreen API on Element prototype and Document
    HTMLElement.prototype.requestFullscreen = requestFullscreenMock;
    document.exitFullscreen = exitFullscreenMock;

    // Mock Screen Orientation API
    Object.defineProperty(window, 'screen', {
      writable: true,
      value: {
        orientation: {
          lock: orientationLockMock,
          unlock: orientationUnlockMock,
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renderiza botón flotante de pantalla completa en el canvas', async () => {
    await act(async () => {
      root.render(
        createElement(NotesCanvas, {
          notes: mockNotes,
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
          onToggle: vi.fn(),
        })
      );
    });

    const fsBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-canvas-fullscreen');
    expect(fsBtn).not.toBeNull();
    expect(fsBtn?.textContent).toContain('Pantalla completa');
  });

  it('al presionar pantalla completa llama a requestFullscreen y screen.orientation.lock', async () => {
    await act(async () => {
      root.render(
        createElement(NotesCanvas, {
          notes: mockNotes,
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
          onToggle: vi.fn(),
        })
      );
    });

    const fsBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-canvas-fullscreen');
    expect(fsBtn).not.toBeNull();

    await act(async () => {
      fsBtn?.click();
    });

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(orientationLockMock).toHaveBeenCalledWith('landscape');
  });

  it('actualiza el estado y clases CSS fluidas ante el evento fullscreenchange', async () => {
    await act(async () => {
      root.render(
        createElement(NotesCanvas, {
          notes: mockNotes,
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
          onToggle: vi.fn(),
        })
      );
    });

    const canvasEl = container.querySelector<HTMLDivElement>('#notes-canvas-container');
    expect(canvasEl?.className).toContain('min-h-[60vh]');

    // Simulamos que el navegador entró a fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      writable: true,
      value: canvasEl,
    });

    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    const fsBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-canvas-fullscreen');
    expect(fsBtn?.textContent).toContain('Salir');
    expect(canvasEl?.className).toContain('min-h-screen');
    expect(canvasEl?.className).toContain('fixed inset-0');

    // Ahora simulamos salir de fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      writable: true,
      value: null,
    });

    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(fsBtn?.textContent).toContain('Pantalla completa');
    expect(orientationUnlockMock).toHaveBeenCalled();
  });

  it('tolera navegadores sin soporte de orientation.lock sin fallar', async () => {
    // Simulamos navegador sin screen.orientation
    Object.defineProperty(window, 'screen', {
      writable: true,
      value: {},
    });

    await act(async () => {
      root.render(
        createElement(NotesCanvas, {
          notes: mockNotes,
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
          onToggle: vi.fn(),
        })
      );
    });

    const fsBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-canvas-fullscreen');
    expect(() => {
      fsBtn?.click();
    }).not.toThrow();
  });
});
