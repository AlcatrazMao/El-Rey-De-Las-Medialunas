import { useRef, useState, useCallback, useEffect } from 'react';

export interface UseLongPressOptions {
  onShortClick?: () => void;
  onLongPress: () => void;
  threshold?: number; // ms to trigger long press (default: 500ms)
  vibrationMs?: number | number[]; // vibration duration (default: 50ms)
  disabled?: boolean;
}

export function useLongPress({
  onShortClick,
  onLongPress,
  threshold = 500,
  vibrationMs = 50,
  disabled = false,
}: UseLongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressTriggered = useRef(false);
  const isTouchActive = useRef(false);
  const startCoords = useRef<{ x: number; y: number } | null>(null);
  const [isPressing, setIsPressing] = useState(false);
  const [isDiscounting, setIsDiscounting] = useState(false);

  // Clear timer helper
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const triggerLongPressAction = useCallback(() => {
    isLongPressTriggered.current = true;
    setIsPressing(false);

    // Feedback táctil con vibración si está disponible en el navegador
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(vibrationMs);
      } catch {
        // Ignorar si el dispositivo no permite vibrar
      }
    }

    // Feedback visual breve
    setIsDiscounting(true);
    setTimeout(() => {
      setIsDiscounting(false);
    }, 400);

    onLongPress();
  }, [onLongPress, vibrationMs]);

  // Touch handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      isTouchActive.current = true;
      isLongPressTriggered.current = false;
      const touch = e.touches[0];
      startCoords.current = { x: touch.clientX, y: touch.clientY };
      setIsPressing(true);

      timerRef.current = setTimeout(() => {
        triggerLongPressAction();
      }, threshold);
    },
    [disabled, threshold, triggerLongPressAction]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startCoords.current || !timerRef.current) return;
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - startCoords.current.x);
      const deltaY = Math.abs(touch.clientY - startCoords.current.y);

      // Si el operador deslizó el dedo para hacer scroll (> 10px), cancelamos el long-press
      if (deltaX > 10 || deltaY > 10) {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const wasLong = isLongPressTriggered.current;
      clearTimer();
      startCoords.current = null;

      // Reseteamos el flag de touch con una pequeña ventana para evitar que el
      // navegador emule mousedown/mouseup sintéticos
      setTimeout(() => {
        isTouchActive.current = false;
      }, 400);

      if (!wasLong) {
        onShortClick?.();
      } else {
        // Prevenir click emulado post-long-press
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    },
    [clearTimer, disabled, onShortClick]
  );

  const handleTouchCancel = useCallback(() => {
    clearTimer();
    startCoords.current = null;
    isTouchActive.current = false;
  }, [clearTimer]);

  // Mouse handlers (Desktop)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || isTouchActive.current) return;
      // Solo click izquierdo
      if (e.button !== 0) return;

      isLongPressTriggered.current = false;
      setIsPressing(true);

      timerRef.current = setTimeout(() => {
        triggerLongPressAction();
      }, threshold);
    },
    [disabled, threshold, triggerLongPressAction]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || isTouchActive.current) return;
      if (e.button !== 0) return;

      const wasLong = isLongPressTriggered.current;
      clearTimer();

      if (!wasLong) {
        onShortClick?.();
      }
    },
    [clearTimer, disabled, onShortClick]
  );

  const handleMouseLeave = useCallback(() => {
    if (disabled || isTouchActive.current) return;
    clearTimer();
  }, [clearTimer, disabled]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Evitar menú contextual nativo al mantener presionado en móvil o desktop
    e.preventDefault();
  }, []);

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      onContextMenu: handleContextMenu,
    },
    isPressing,
    isDiscounting,
  };
}
