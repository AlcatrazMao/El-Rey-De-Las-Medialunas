/**
 * Read and JSON-parse a localStorage entry, falling back to `fallback` when the
 * key is missing, the JSON is corrupt, or the parsed value is null/undefined.
 *
 * The same pattern was previously duplicated as a private `safeParse` in
 * every hook that hydrates from localStorage. Centralising it removes the
 * drift risk and the noisy console.error/removeItem dance.
 */
export function safeParseLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    try { localStorage.removeItem(key); } catch { /* ignore — quota/private mode */ }
    return fallback;
  }
}

export const safeSetItem = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const safeRemoveItem = (key: string): boolean => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
