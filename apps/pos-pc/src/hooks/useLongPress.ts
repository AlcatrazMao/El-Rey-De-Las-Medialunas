import { useRef, useState, useCallback, useEffect } from 'react';

export interface UseLongPressOptions {
  onShortClick?: () => void;
  onLongPress: () => void;
  onRightClick?: () => void;
  threshold?: number; // ms to trigger long press (default: 500ms)
  vibrationMs?: number | number[]; // vibration duration (default: 50ms)
  disabled?: boolean;
}

export function useLongPress({
  onShortClick,
  onLongPress,
  onRightClick,
  threshold = 500,
  vibrationMs = 50,
  disabled = false,
}: UseLongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressTriggered = useRef(false);
  const isTouchActive = useRef(false);
  const startCoords = useRef<{ x: number; y: number } | null>(null);
  const rightClickHandledRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isDiscounting, setIsDiscounting] = useState(false);

  // Refs para evitar closures obsoletas durante temporizadores
  const onShortClickRef = useRef(onShortClick);
  const onLongPressRef = useRef(onLongPress);
  const onRightClickRef = useRef(onRightClick);
  onShortClickRef.current = onShortClick;
  onLongPressRef.current = onLongPress;
  onRightClickRef.current = onRightClick;

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

    onLongPressRef.current?.();
  }, [vibrationMs]);

  const triggerRightClickAction = useCallback(() => {
    if (disabled) return;

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(vibrationMs);
      } catch {
        // Ignorar si el dispositivo no permite vibrar
      }
    }

    setIsDiscounting(true);
    setTimeout(() => {
      setIsDiscounting(false);
    }, 400);

    if (onRightClickRef.current) {
      onRightClickRef.current();
    } else {
      onLongPressRef.current?.();
    }
  }, [disabled, vibrationMs]);

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
        onShortClickRef.current?.();
      } else {
        // Prevenir click emulado post-long-press
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    },
    [clearTimer, disabled]
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

      // Click derecho: decremento inmediato
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        clearTimer();
        rightClickHandledRef.current = true;
        triggerRightClickAction();
        return;
      }

      // Solo click izquierdo
      if (e.button !== 0) return;

      isLongPressTriggered.current = false;
      startCoords.current = { x: e.clientX, y: e.clientY };
      setIsPressing(true);

      timerRef.current = setTimeout(() => {
        triggerLongPressAction();
      }, threshold);
    },
    [clearTimer, disabled, threshold, triggerLongPressAction, triggerRightClickAction]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!startCoords.current || !timerRef.current) return;
      const deltaX = Math.abs(e.clientX - startCoords.current.x);
      const deltaY = Math.abs(e.clientY - startCoords.current.y);

      // Si el operador movió el mouse intencionalmente (> 15px), cancelamos el long-press
      if (deltaX > 15 || deltaY > 15) {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || isTouchActive.current) return;

      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.button !== 0) return;

      const wasLong = isLongPressTriggered.current;
      clearTimer();
      startCoords.current = null;

      if (!wasLong) {
        onShortClickRef.current?.();
      } else {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    },
    [clearTimer, disabled]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || isTouchActive.current) return;

      // Si el operador está presionando y el mouse se movió apenas dentro de la tolerancia
      // (por ejemplo por transiciones o transform: scale del botón), NO cancelamos.
      if (startCoords.current && timerRef.current) {
        const deltaX = Math.abs(e.clientX - startCoords.current.x);
        const deltaY = Math.abs(e.clientY - startCoords.current.y);
        if (deltaX <= 15 && deltaY <= 15) {
          return;
        }
      }

      clearTimer();
      startCoords.current = null;
    },
    [clearTimer, disabled]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (isLongPressTriggered.current) {
        e.preventDefault();
        e.stopPropagation();
        isLongPressTriggered.current = false;
        return;
      }
      if (e.detail === 0) {
        onShortClickRef.current?.();
      }
    },
    [disabled]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (rightClickHandledRef.current) {
        rightClickHandledRef.current = false;
        return;
      }
      triggerRightClickAction();
    },
    [triggerRightClickAction]
  );

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      onClick: handleClick,
      onContextMenu: handleContextMenu,
    },
    isPressing,
    isDiscounting,
  };
}
