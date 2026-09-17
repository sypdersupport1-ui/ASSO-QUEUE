import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    // Live-DB setup suites run 50 files in parallel against one shared
    // Postgres; fixture setup/teardown hooks can stall past the 10s default
    // under contention. 30s keeps genuine hangs failing fast enough.
    hookTimeout: 30000,
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/mocks/server-only.ts'),
    },
  },
});
