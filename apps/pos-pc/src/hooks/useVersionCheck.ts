import { useEffect, useState } from "react";

const BUILD_ID =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_BUILD_ID ?? "";

const POLL_INTERVAL = 24 * 60 * 60 * 1000;

// Keys that are remote-cache only — safe to evict on build change.
// Never add sales, cash sessions, invoice_seq or other user-generated data here.
const LS_CACHE_KEYS = [
  "pan_erp_products",
  "pan_erp_ingredients",
  "pan_erp_gateways",
  "pan_erp_notifications",
];

export function useVersionCheck(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // On mount: if the build changed, evict stale cache and record new build.
  useEffect(() => {
    if (!BUILD_ID) return;
    const stored = localStorage.getItem("app_build_id");
    if (stored !== BUILD_ID) {
      LS_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
      localStorage.setItem("app_build_id", BUILD_ID);
    }
  }, []);

  // Poll /version.json every 24 h. If the server has a newer build, prompt reload.
  useEffect(() => {
    if (!BUILD_ID) return;

    async function poll() {
      try {
        const res = await fetch(`/version.json?_=${Date.now()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (data.buildId && data.buildId !== BUILD_ID) setUpdateAvailable(true);
      } catch {
        // offline or network error — silently skip
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return updateAvailable;
}
