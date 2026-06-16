import { writeFileSync } from "fs";
import { resolve } from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const buildId = Date.now().toString(36);

export default defineConfig({
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "version-file",
      buildStart() {
        writeFileSync(
          resolve(process.cwd(), "public/version.json"),
          JSON.stringify({ buildId, builtAt: new Date().toISOString() }, null, 2),
        );
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 3000,
  },
});
