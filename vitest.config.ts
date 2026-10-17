import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // solo la lógica pura: el visor 3D y la interfaz se cubren con las pruebas de extremo a extremo
      include: ['src/avatar/catalog.ts', 'src/state/save.ts', 'src/router.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 80, functions: 90, statements: 90 },
    },
  },
})
