import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  test: { include: ['tests/**/*.test.ts'] },
})
