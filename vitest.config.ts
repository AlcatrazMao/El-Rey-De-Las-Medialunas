import { defineConfig } from 'vitest/config';

// Config raíz de vitest. Reemplaza a la anterior en test/vitest.config.ts, que
// estaba rota (root:'.' + include 'test/**' resolvían a test/test/**) y no se
// cargaba al correr `vitest` desde la raíz — por eso los tests que usan
// localStorage fallaban con "localStorage is not defined" (sin environment).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '.claude/**',
      'apps/**',
      'workers/**',
      'packages/**',
      'migrations/**',
    ],
    globals: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './test/coverage',
    },
  },
});
