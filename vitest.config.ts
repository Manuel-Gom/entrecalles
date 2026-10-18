import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // solo la lógica pura: el visor 3D, la animación de huesos y la interfaz se cubren con las pruebas de extremo a extremo
      include: [
        'src/avatar/catalog.ts', 'src/state/save.ts', 'src/router.ts',
        'src/world/collision.ts', 'src/world/layout.ts', 'src/world/gait.ts', 'src/world/player.ts',
        'src/world/brain.ts', 'src/world/cast.ts', 'src/world/followCamera.ts',
        'src/world/input.ts', 'src/world/perf.ts', 'src/world/seating.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 80, functions: 90, statements: 90 },
    },
  },
})
