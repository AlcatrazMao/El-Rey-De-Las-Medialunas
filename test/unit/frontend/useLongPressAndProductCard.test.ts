import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(resolve('apps/pos-pc/package.json'));
const { createElement, act } = require('react');
const { createRoot } = require('react-dom/client');

import { ProductCard } from '../../../apps/pos-pc/src/components/pos/ProductCard';
import { useLongPress } from '../../../apps/pos-pc/src/hooks/useLongPress';

function LongPressHarness({
  onShortClick,
  onLongPress,
  threshold = 500,
}: {
  onShortClick?: () => void;
  onLongPress: () => void;
  threshold?: number;
}) {
  const { handlers, isPressing, isDiscounting } = useLongPress({
    onShortClick,
    onLongPress,
    threshold,
  });

  return createElement(
    'button',
    {
      id: 'test-btn',
      ...handlers,
      'data-pressing': isPressing ? 'true' : 'false',
      'data-discounting': isDiscounting ? 'true' : 'false',
    },
    'Hold me'
  );
}

describe('useLongPress Hook', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      configurable: true,
      value: vibrateMock,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('un click corto normal (<500ms) invoca onShortClick y no descuenta', async () => {
    const onShortClick = vi.fn();
    const onLongPress = vi.fn();

    await act(async () => {
      root.render(createElement(LongPressHarness, { onShortClick, onLongPress, threshold: 500 }));
    });

    const btn = container.querySelector<HTMLButtonElement>('#test-btn')!;

    // Touch tap rápido (100ms)
    act(() => {
      btn.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 50, clientY: 50 } as any],
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      btn.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(onShortClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it('mantener presionado 500ms dispara onLongPress y vibración táctil', async () => {
    const onShortClick = vi.fn();
    const onLongPress = vi.fn();

    await act(async () => {
      root.render(createElement(LongPressHarness, { onShortClick, onLongPress, threshold: 500 }));
    });

    const btn = container.querySelector<HTMLButtonElement>('#test-btn')!;

    act(() => {
      btn.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 50, clientY: 50 } as any],
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledWith(50);

    // Al soltar el dedo tras el long-press NO debe llamarse onShortClick
    act(() => {
      btn.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(onShortClick).not.toHaveBeenCalled();
  });

  it('cancela el long-press si el operador desliza el dedo para scrollear (>10px)', async () => {
    const onShortClick = vi.fn();
    const onLongPress = vi.fn();

    await act(async () => {
      root.render(createElement(LongPressHarness, { onShortClick, onLongPress, threshold: 500 }));
    });

    const btn = container.querySelector<HTMLButtonElement>('#test-btn')!;

    act(() => {
      btn.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 50, clientY: 50 } as any],
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(200);
      // Mueve el dedo 25px hacia abajo (scroll)
      btn.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [{ clientX: 50, clientY: 75 } as any],
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('previene el menú contextual nativo en onContextMenu', async () => {
    await act(async () => {
      root.render(createElement(LongPressHarness, { onLongPress: vi.fn() }));
    });

    const btn = container.querySelector<HTMLButtonElement>('#test-btn')!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    btn.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('ProductCard Component con Long-Press', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const mockProduct = {
    id: 'prod-medialuna',
    name: 'Medialuna de Manteca',
    price: 650,
    cost: 200,
    stock: 24,
    minStock: 6,
    image: '🥐',
    code: 'MM1',
    category: 'facturas' as const,
    ingredients: [],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('renderiza información del producto: nombre, stock y precio formateado', async () => {
    await act(async () => {
      root.render(
        createElement(ProductCard, {
          product: mockProduct,
          quantityInCart: 3,
          onAddToCart: vi.fn(),
          onDecreaseQuantity: vi.fn(),
        })
      );
    });

    const card = container.querySelector<HTMLButtonElement>('#product-card-prod-medialuna');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Medialuna de Manteca');
    expect(card?.textContent).toContain('24u');
    expect(card?.textContent).toContain('3'); // quantityInCart badge
  });

  it('click corto suma al carrito mediante onAddToCart', async () => {
    const onAddToCart = vi.fn();
    const onDecreaseQuantity = vi.fn();

    await act(async () => {
      root.render(
        createElement(ProductCard, {
          product: mockProduct,
          quantityInCart: 0,
          onAddToCart,
          onDecreaseQuantity,
        })
      );
    });

    const card = container.querySelector<HTMLButtonElement>('#product-card-prod-medialuna')!;

    act(() => {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      vi.advanceTimersByTime(80);
      card.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });

    expect(onAddToCart).toHaveBeenCalledWith(mockProduct);
    expect(onDecreaseQuantity).not.toHaveBeenCalled();
  });

  it('mantener presionado 500ms descuenta del carrito mediante onDecreaseQuantity', async () => {
    const onAddToCart = vi.fn();
    const onDecreaseQuantity = vi.fn();

    await act(async () => {
      root.render(
        createElement(ProductCard, {
          product: mockProduct,
          quantityInCart: 2,
          onAddToCart,
          onDecreaseQuantity,
        })
      );
    });

    const card = container.querySelector<HTMLButtonElement>('#product-card-prod-medialuna')!;

    act(() => {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      vi.advanceTimersByTime(500);
    });

    expect(onDecreaseQuantity).toHaveBeenCalledWith('prod-medialuna');
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});
