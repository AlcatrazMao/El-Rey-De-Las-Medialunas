import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import styles from './Toast.module.css';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = 'info', duration = 4000) => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, message, type, duration }]);
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={styles.container} aria-live="polite" role="status">
        {toasts.map((toast) => (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`}>
            <span className={styles.message}>{toast.message}</span>
            <button
              className={styles.dismiss}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export type { ToastType };
