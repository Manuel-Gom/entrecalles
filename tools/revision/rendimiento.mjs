// Mide el rendimiento del barrio en las tres calidades, con la misma ruta y el mismo número de vecinos, para comparar equipos.
// Uso: npm run build && node tools/revision/rendimiento.mjs [--pnj=16] [--segundos=10] [--ventana]
//   --pnj=N       vecinos que se cargan (0-16; por defecto 16)
//   --segundos=N  cuánto se mide cada calidad (por defecto 10)
//   --ventana     abre Chromium con ventana y la tarjeta gráfica real (sin el dibujado por software de las pruebas)
// Imprime una tabla y guarda docs/previews/web/rendimiento.json. Con el 3D por software los números solo sirven para
// comprobar que la herramienta funciona: el dato que importa es el de tu equipo, con --ventana.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const argumento = (nombre, defecto) => Number(process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1] ?? defecto)
const PNJ = argumento('pnj', 16)
const SEGUNDOS = argumento('segundos', 10)
const VENTANA = process.argv.includes('--ventana')
const PORT = 4200 + Math.floor(Math.random() * 700)
const OUT = path.join(process.cwd(), 'docs/previews/web')
fs.mkdirSync(OUT, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'pipe' })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('El servidor no arrancó')), 20000)
  server.stdout.on('data', (data) => {
    if (String(data).includes('Local')) {
      clearTimeout(timer)
      resolve()
    }
  })
})

const args = VENTANA ? ['--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ headless: !VENTANA, args })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
const save = {
  version: 2,
  characters: [{ id: 'a', name: 'Medición', spec: { cuerpo: 'marcos' } }],
  activeId: 'a',
  difficulty: 'equilibrada',
  settings: { masterVolume: 80, musicVolume: 65, effectsVolume: 80, controlPreset: 'clasico', subtitles: true, highContrast: false, reducedMotion: false, largeText: false },
}
await page.addInitScript(([value, limite]) => {
  localStorage.setItem('entrecalles-save-v2', JSON.stringify(value))
  window.__WORLD_NPC_LIMIT__ = limite
}, [save, PNJ])
await page.goto(`http://localhost:${PORT}/#/jugar`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120000 })
await page.waitForFunction((n) => { const s = window.__world().stats(); return s.npcs.loaded >= n }, PNJ, { timeout: 480000 })
// se deja que las calles se animen un poco antes de medir
await page.evaluate(() => window.__world().advance(30))

const filas = []
for (const calidad of ['baja', 'media', 'alta']) {
  await page.evaluate((q) => {
    const w = window.__world()
    w.setQuality(q)
    // el protagonista corre en círculos por la plaza, con la cámara girando: el mismo recorrido en cada calidad
    w.teleport(0, 16.7, 0)
    w.inputOverride = { moveX: 1, moveZ: 0.3, run: true }
  }, calidad)
  await page.waitForTimeout(1500) // deja asentarse el cambio
  await page.evaluate(() => window.__world().resetDiagnostics())
  const inicio = Date.now()
  while (Date.now() - inicio < SEGUNDOS * 1000) {
    await page.evaluate(() => {
      const w = window.__world()
      const s = w.stats()
      // si se aleja de la plaza, vuelve
      if (Math.hypot(s.player.x, s.player.z) > 30) w.teleport(0, 16.7, 0)
      w.orbitCamera(s.cameraYaw + 0.2, 0.3, 4.6)
    })
    await page.waitForTimeout(500)
  }
  filas.push(await page.evaluate(() => window.__world().performance()))
}
await page.evaluate(() => (window.__world().inputOverride = null))
await browser.close()
server.kill()
spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true })

const tabla = [
  '| Calidad | FPS | ms/fotograma | 1 % más lento | peor | Resolución | Triángulos | Llamadas |',
  '|---|---|---|---|---|---|---|---|',
  ...filas.map((f) => `| ${f.quality} | ${f.fps.toFixed(0)} | ${f.avgMs.toFixed(1)} | ${f.p99Ms.toFixed(1)} ms | ${f.worstMs.toFixed(1)} ms | ${f.width}×${f.height} | ${f.triangles.toLocaleString('es')} | ${f.calls} |`),
].join('\n')
console.log(`\nVecinos: ${filas[0].npcs} · ${SEGUNDOS} s por calidad · ${VENTANA ? 'tarjeta gráfica real' : 'dibujado por software (SwiftShader)'}\nTarjeta: ${filas[0].gpu}\n\n${tabla}\n`)
fs.writeFileSync(path.join(OUT, 'rendimiento.json'), JSON.stringify({ fecha: new Date().toISOString(), ventana: VENTANA, filas }, null, 2))
process.exit(0)
