import { defineConfig } from '@playwright/test'

const PORT = 4173
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'e2e',
  // el Chromium sin tarjeta gráfica dibuja el 3D por software: las pruebas necesitan margen
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'escritorio', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'movil', use: { viewport: { width: 390, height: 844 } }, testMatch: /(pantallas|movil)\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 240_000,
  },
})
