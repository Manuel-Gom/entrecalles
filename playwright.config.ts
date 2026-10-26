import { defineConfig } from '@playwright/test'

const PORT = 4173
const CI = Boolean(process.env.CI)
// En local, el 3D se dibuja con la tarjeta gráfica del equipo (aunque sea integrada): por software (SwiftShader) cada
// navegador ocupa varios núcleos y el equipo se queda sin CPU. En integración continua no hay tarjeta; E2E_SOFTWARE=1
// fuerza el software también en local (por ejemplo, para reproducir un fallo de la integración continua).
const SOFTWARE = CI || Boolean(process.env.E2E_SOFTWARE)

export default defineConfig({
  testDir: 'e2e',
  // con el 3D por software las pruebas necesitan margen
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    deviceScaleFactor: 1,
    launchOptions: {
      args: SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'],
    },
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
