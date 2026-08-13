import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/*/src/**/*.integration.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
  },
});
