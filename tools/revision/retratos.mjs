// Genera los retratos de los PNJ (public/npcs/retratos/<id>.webp) con el visor 3D en un Chromium real.
// Uso: npm run build && node tools/revision/retratos.mjs [--todos] [--limite=N]
// Por defecto solo crea los que faltan.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const all = process.argv.includes('--todos')
const PORT = 4200 + Math.floor(Math.random() * 700)
const OUT = path.join(process.cwd(), 'public/npcs/retratos')
fs.mkdirSync(OUT, { recursive: true })
const npcs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/npcs.json'), 'utf8'))
const limit = Number(process.argv.find((arg) => arg.startsWith('--limite='))?.split('=')[1] ?? Infinity)
const pending = npcs.filter((npc) => all || !fs.existsSync(path.join(OUT, `${npc.id}.webp`))).slice(0, limit)
if (all && !Number.isFinite(limit)) for (const file of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, file))
console.log(`${pending.length} retratos por generar`)

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
const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(`http://localhost:${PORT}/?herramientas#/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__renderThumbnail === 'function', null, { timeout: 60000 })
const catalog = await page.evaluate(() => fetch('/models/modular/manifest.json').then((response) => response.json()))

let done = 0
for (const npc of pending) {
  const url = await page.evaluate(async ([spec, data]) => {
    return window.__renderThumbnail(spec, data)
  }, [npc.spec, catalog])
  fs.writeFileSync(path.join(OUT, `${npc.id}.webp`), Buffer.from(url.split(',')[1], 'base64'))
  done += 1
  if (done % 20 === 0) console.log(`${done}/${pending.length}`)
}
await browser.close()
server.kill()
spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true })
console.log(errors.length ? `Errores:\n${errors.join('\n')}` : `Retratos listos (${done})`)
