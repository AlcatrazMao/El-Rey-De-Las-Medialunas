/**
 * Genera un identificador único de 32 caracteres hexadecimales (UUIDv4 sin guiones, lowercase).
 * Centraliza el patrón `crypto.randomUUID().replace(/-/g, "").toLowerCase()` repetido en routes.
 */
export function genId(): string {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}
