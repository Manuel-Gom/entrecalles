// Muestra en el visor 3D del navegador todos los cuerpos con su atuendo por defecto y genera una hoja de contacto.
// Uso: npm run build && node tools/revision/cuerpos.mjs [hombre|mujer]
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const aspectos = process.argv.find((arg) => arg.startsWith('--aspectos='))?.split('=')[1]
const genero = process.argv[2]?.startsWith('--') ? undefined : process.argv[2]
const PORT = 4200 + Math.floor(Math.random() * 700)
const OUT = path.join(process.cwd(), 'docs/previews/web')
fs.mkdirSync(OUT, { recursive: true })
const tmp = path.join(OUT, 'tmp-cuerpos')
fs.rmSync(tmp, { recursive: true, force: true })
fs.mkdirSync(tmp)

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

const errors = []
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 520, height: 900 } })
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__avatarStudio === 'function' && window.__avatarStudio().stats().state === 'ready', null, { timeout: 40000 })

const catalog = await page.evaluate(() => fetch('/models/modular/manifest.json').then((response) => response.json()))
const custom = aspectos ? JSON.parse(fs.readFileSync(aspectos, 'utf8')) : null
const bodies = custom ?? catalog.cuerpos.filter((body) => !genero || (body.genero ?? 'hombre') === genero)
const files = []
for (const body of bodies) {
  const spec = custom
    ? { pelo: null, torso: null, piernas: null, conjunto: null, calzado: null, cabeza: null, gafas: null, barba: null, colorPelo: null, ...body }
    : { cuerpo: body.id, pelo: null, torso: null, piernas: null, conjunto: null, calzado: null, cabeza: null, gafas: null, barba: null, colorPelo: body.colorPelo ?? null, ...body.defecto }
  const label = custom ? `${String(files.length + 1).padStart(2, '0')}-${spec.cuerpo}` : body.id
  await page.evaluate(([value, data]) => window.__avatarStudio().setAvatar(value, data), [spec, catalog])
  await page.waitForFunction((id) => { const s = window.__avatarStudio().stats(); return s.state === 'ready' && s.model === id }, spec.cuerpo, { timeout: 40000 })
  await page.waitForTimeout(500)
  const file = path.join(tmp, `${label}.png`)
  await page.locator('.stage').first().screenshot({ path: file })
  files.push(file)
  console.log(label)
}
await browser.close()
// en Windows se mata todo el árbol (npx y vite) antes que nada: matando primero el intérprete, vite quedaba huérfano
if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
else server.kill()
console.log(errors.length ? `Errores:\n${errors.join('\n')}` : 'Sin errores de consola')
fs.writeFileSync(path.join(tmp, 'lista.txt'), files.join('\n'))
