import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Playwright end-to-end specs land in Phase 8 and run separately.
    exclude: ['node_modules', '.next', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
      // `server-only` is a build-time guard, not behaviour: its real package
      // throws unless Node resolves under the `react-server` condition, which
      // is how a mistaken import into a client bundle becomes an error. Vitest
      // does not use that condition, so a module carrying the guard cannot be
      // unit tested at all without this.
      //
      // Stubbed here only. `npm run build` still fails if server-only code is
      // ever pulled into a client bundle, which is where the guard earns its
      // place.
      'server-only': resolve(import.meta.dirname, './scripts/stubs/server-only.ts'),
    },
  },
});
