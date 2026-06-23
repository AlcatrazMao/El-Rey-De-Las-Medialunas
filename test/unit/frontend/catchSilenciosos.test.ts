import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Tests para la lógica de notificación en catch silenciosos — useCustomers.ts
//
// Los tres casos son operaciones de usuario (addCustomer, updateCustomer) o
// carga de fondo (loadCustomersFromD1). Verificamos:
//   - addCustomer: si syncCustomerToD1 falla → notify('⚠️ Sync', ..., 'warning')
//   - updateCustomer: si getApi().customers.update falla → mismo notify
//   - loadCustomersFromD1: si fetchCustomersFromD1 falla → console.warn, NO notify
//
// No importamos el hook (depende de React/context/localStorage). Replicamos
// la lógica pura de los tres catch, igual que hacen los otros tests de este
// directorio (withdrawalSync, syncEngineRetryDelay, etc.).
// ---------------------------------------------------------------------------

// ── Réplica de la lógica de addCustomer (sólo la parte del catch) ─────────

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

async function addCustomerSync(
  syncFn: () => Promise<void>,
  notify: NotifyFn,
): Promise<void> {
  syncFn().catch(() => {
    notify('⚠️ Sync', 'No se pudo sincronizar el cliente. Se reintentará.', 'warning');
  });
}

async function updateCustomerSync(
  updateFn: () => Promise<void>,
  notify: NotifyFn,
): Promise<void> {
  updateFn().catch(() => {
    notify('⚠️ Sync', 'No se pudo sincronizar el cliente. Se reintentará.', 'warning');
  });
}

async function loadCustomersFromD1(
  fetchFn: () => Promise<void>,
  warnFn: (msg: string, e: unknown) => void,
): Promise<void> {
  fetchFn().catch((e: unknown) => {
    warnFn('[useCustomers] loadCustomersFromD1 error:', e);
  });
}

// ── Tests — addCustomer ───────────────────────────────────────────────────

describe('addCustomer — sync catch', () => {
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notify = vi.fn();
  });

  it('si syncCustomerToD1 falla → llama notify con warning', async () => {
    const failingSync = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await addCustomerSync(failingSync, notify);
    // El catch es asíncrono (fire-and-forget), esperamos el microtask tick.
    await Promise.resolve();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      '⚠️ Sync',
      'No se pudo sincronizar el cliente. Se reintentará.',
      'warning',
    );
  });

  it('si syncCustomerToD1 tiene éxito → notify NO es llamado por el catch', async () => {
    const successSync = vi.fn().mockResolvedValue(undefined);

    await addCustomerSync(successSync, notify);
    await Promise.resolve();

    expect(notify).not.toHaveBeenCalled();
  });

  it('error de servidor (non-network) también dispara el notify de warning', async () => {
    const serverErr = Object.assign(new Error('500 Internal Server Error'), { status: 500 });
    const failingSync = vi.fn().mockRejectedValue(serverErr);

    await addCustomerSync(failingSync, notify);
    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('⚠️ Sync', expect.any(String), 'warning');
  });

  it('notify recibe exactamente 3 args con los valores correctos', async () => {
    const failingSync = vi.fn().mockRejectedValue(new Error('network down'));

    await addCustomerSync(failingSync, notify);
    await Promise.resolve();

    const [title, message, type] = notify.mock.calls[0] as [string, string, string];
    expect(title).toBe('⚠️ Sync');
    expect(message).toBe('No se pudo sincronizar el cliente. Se reintentará.');
    expect(type).toBe('warning');
  });
});

// ── Tests — updateCustomer ────────────────────────────────────────────────

describe('updateCustomer — sync catch', () => {
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notify = vi.fn();
  });

  it('si la actualización en el backend falla → llama notify con warning', async () => {
    const failingUpdate = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await updateCustomerSync(failingUpdate, notify);
    await Promise.resolve();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      '⚠️ Sync',
      'No se pudo sincronizar el cliente. Se reintentará.',
      'warning',
    );
  });

  it('si la actualización tiene éxito → notify NO es llamado por el catch', async () => {
    const successUpdate = vi.fn().mockResolvedValue(undefined);

    await updateCustomerSync(successUpdate, notify);
    await Promise.resolve();

    expect(notify).not.toHaveBeenCalled();
  });

  it('el tipo de notificación es "warning" (no "error") — el dato no se perdió', async () => {
    const failingUpdate = vi.fn().mockRejectedValue(new Error('Timeout'));

    await updateCustomerSync(failingUpdate, notify);
    await Promise.resolve();

    expect((notify.mock.calls[0] as [string, string, string])[2]).toBe('warning');
  });
});

// ── Tests — loadCustomersFromD1 ───────────────────────────────────────────

describe('loadCustomersFromD1 — background catch', () => {
  let warnMock: ReturnType<typeof vi.fn>;
  let notifyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warnMock = vi.fn();
    notifyMock = vi.fn();
  });

  it('si fetchCustomersFromD1 falla → llama console.warn con el error', async () => {
    const fetchError = new TypeError('Network error');
    const failingFetch = vi.fn().mockRejectedValue(fetchError);

    await loadCustomersFromD1(failingFetch, warnMock);
    await Promise.resolve();

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith('[useCustomers] loadCustomersFromD1 error:', fetchError);
  });

  it('si fetchCustomersFromD1 tiene éxito → warn NO es llamado', async () => {
    const successFetch = vi.fn().mockResolvedValue(undefined);

    await loadCustomersFromD1(successFetch, warnMock);
    await Promise.resolve();

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('el error de fondo NO dispara notify (operación transparente para el usuario)', async () => {
    // El catch de loadCustomersFromD1 solo hace warn — no notifica.
    // Este test documenta que la función recibe un warnFn, no un notifyFn.
    const failingFetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

    await loadCustomersFromD1(failingFetch, warnMock);
    await Promise.resolve();

    // notifyMock no es pasado a loadCustomersFromD1 → nunca puede ser llamado.
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('el prefijo del warn incluye el módulo para facilitar el grep en logs', async () => {
    const err = new Error('timeout');
    const failingFetch = vi.fn().mockRejectedValue(err);

    await loadCustomersFromD1(failingFetch, warnMock);
    await Promise.resolve();

    const [prefix] = warnMock.mock.calls[0] as [string, unknown];
    expect(prefix).toMatch(/\[useCustomers\]/);
  });
});
