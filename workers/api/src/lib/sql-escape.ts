/**
 * Escapa los caracteres especiales de LIKE (backslash, %, _) para usarlos
 * con `LIKE ? ESCAPE '\\'` en SQLite / D1.
 *
 * El orden de la clase de caracteres importa: el backslash debe aparecer
 * primero para que $& lo escape antes de que el motor procese % y _.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
