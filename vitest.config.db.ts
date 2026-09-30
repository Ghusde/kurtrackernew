import { defineConfig } from 'vitest/config';

// Separate config for the destructive database tests: `npm run test:db`.
// The default `npm test` run skips them.
export default defineConfig({
  test: {
    include: ['tests/integration.test.ts'],
    setupFiles: ['tests/setup.db.ts'],
    fileParallelism: false
  }
});
