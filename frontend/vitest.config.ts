import { defineConfig } from 'vitest/config'
import path from 'path'

// The frontend's first tests. Deliberately node-environment, not jsdom: what is under test here
// is `lib/reports.ts` — pure report math with no React and no DOM — and pulling in jsdom for it
// would add a dependency and a lot of startup cost for nothing. Add an environment override per
// file if a real component test is ever written.
//
// Vite resolves @currencydesk/engine's "development" export condition automatically, so these
// tests run against live engine source with no build step, exactly like `npm run dev` does.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
