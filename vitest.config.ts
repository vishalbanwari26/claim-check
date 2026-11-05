import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    env: { CLAIM_CHECK_DB: `file:${join(tmpdir(), `claim-check-test-${process.pid}.db`)}` },
  },
})
