import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    root: '.',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['.claude/worktrees/**'],
    globals: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './test/coverage',
    },
  },
});
