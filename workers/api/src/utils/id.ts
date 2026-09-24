/**
 * Genera un identificador único de 32 caracteres hexadecimales (UUIDv4 sin guiones, lowercase).
 * Centraliza el patrón `crypto.randomUUID().replace(/-/g, "").toLowerCase()` repetido en routes.
 */
export function genId(): string {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}

/** Preserve known POS IDs so later void/refund operations refer to the same row. */
export function normalizeClientSaleId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id.replace(/-/g, '');
  if (/^sale_[0-9]+_[a-z0-9]{1,32}$/.test(id)) return id;
  return null;
}
