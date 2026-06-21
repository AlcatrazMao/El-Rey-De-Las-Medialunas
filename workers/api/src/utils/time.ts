/**
 * Devuelve el timestamp actual en formato compatible con SQLite (`YYYY-MM-DD HH:MM:SS`, UTC).
 * Centraliza el patrón `new Date().toISOString().replace("T", " ").slice(0, 19)` repetido en routes.
 */
export function nowSqliteTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
