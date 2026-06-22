import { describe, it, expect, vi } from 'vitest';

// Lógica pura que replica el patrón `isMountedRef` usado en POSView.tsx para
// abortar callbacks async (delays del flujo de pago, scanner demo) cuando el
// componente se desmontó. Mantener la lógica como función pura nos permite
// testearla sin React Testing Library — el orquestador la migró a ref + effect
// en el componente, pero la semántica es exactamente la misma.
function createMountedGuard() {
  let mounted = true;
  const unmount = () => { mounted = false; };
  const runIfMounted = (fn: () => void) => { if (mounted) fn(); };
  const isMounted = () => mounted;
  return { unmount, runIfMounted, isMounted };
}

describe('POSView mount guard (isMountedRef pattern)', () => {
  it('ejecuta el callback si el componente sigue montado', () => {
    const guard = createMountedGuard();
    const fn = vi.fn();
    guard.runIfMounted(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('NO ejecuta el callback si se desmontó antes del fire', () => {
    const guard = createMountedGuard();
    const fn = vi.fn();
    guard.unmount();
    guard.runIfMounted(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('discrimina entre múltiples calls antes y después del unmount', () => {
    const guard = createMountedGuard();
    const before1 = vi.fn();
    const before2 = vi.fn();
    const after1 = vi.fn();
    const after2 = vi.fn();

    guard.runIfMounted(before1);
    guard.runIfMounted(before2);
    expect(guard.isMounted()).toBe(true);

    guard.unmount();

    guard.runIfMounted(after1);
    guard.runIfMounted(after2);

    expect(before1).toHaveBeenCalledTimes(1);
    expect(before2).toHaveBeenCalledTimes(1);
    expect(after1).not.toHaveBeenCalled();
    expect(after2).not.toHaveBeenCalled();
  });

  it('es idempotente: llamar unmount dos veces no resetea el estado', () => {
    const guard = createMountedGuard();
    guard.unmount();
    guard.unmount();
    const fn = vi.fn();
    guard.runIfMounted(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(guard.isMounted()).toBe(false);
  });

  it('simula el flujo real: setTimeout que dispara addSale tras unmount', () => {
    vi.useFakeTimers();
    const guard = createMountedGuard();
    const addSale = vi.fn();

    // Replica el patrón en POSView.tsx → safeTimeout(() => { if (!isMountedRef.current) return; addSale(...); }, 150)
    setTimeout(() => { guard.runIfMounted(() => addSale('cart-snapshot')); }, 150);

    // Operador navega a otra vista antes de los 150ms
    guard.unmount();

    vi.advanceTimersByTime(150);

    expect(addSale).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('si NO se desmonta antes del fire, addSale corre normalmente', () => {
    vi.useFakeTimers();
    const guard = createMountedGuard();
    const addSale = vi.fn();

    setTimeout(() => { guard.runIfMounted(() => addSale('cart-snapshot')); }, 150);

    vi.advanceTimersByTime(150);

    expect(addSale).toHaveBeenCalledTimes(1);
    expect(addSale).toHaveBeenCalledWith('cart-snapshot');

    vi.useRealTimers();
  });
});
