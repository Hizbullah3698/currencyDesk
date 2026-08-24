import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Every integration test shares one real Postgres test database (see package.json's
    // `pretest`/`test` scripts) and resets it with a TRUNCATE at the start of its own file —
    // running files concurrently would let one file's reset wipe another's fixtures mid-run.
    fileParallelism: false,
    testTimeout: 20000,
    setupFiles: ['./src/test/guardTestDatabase.ts'],
  },
})
