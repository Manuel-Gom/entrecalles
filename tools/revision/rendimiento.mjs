// Mide el rendimiento del barrio en las tres calidades, con la misma ruta y el mismo número de vecinos, para comparar equipos.
// Uso: npm run build && node tools/revision/rendimiento.mjs [opciones]
//   --pnj=N              vecinos que se cargan (0-16; por defecto 16)
//   --segundos=N         cuánto se mide cada combinación (por defecto 10)
//   --ventana            abre Chromium con ventana y la tarjeta gráfica real (sin el dibujado por software de las pruebas)
//   --sin-limite         sin sincronía vertical ni tope de FPS: mide lo que da la tarjeta, no la frecuencia del monitor
//                        (los FPS medios valen; los tirones no: Chromium encola fotogramas y da uno lento cada ~150 ms)
//   --hora=HH:MM         fija el reloj del barrio (por ejemplo 13:00 de día, 23:30 de noche); sin ella usa la del ordenador
//   --sitios=centro,borde  dónde corre el protagonista (por defecto centro: la plaza junto al parque)
//   --calidades=media,alta qué calidades se miden (por defecto las tres)
//   --resolucion=1920x1080 tamaño de la ventana (por defecto 1280x720)
//   --anochecer          además, mide el peor fotograma al anochecer y al amanecer (cuando se encienden y se apagan las
//                        farolas), en frío, como quien empezó a jugar con la otra luz; mídelo sin --sin-limite
//   --etiqueta=nombre    guarda el resultado como rendimiento-nombre.json (para comparar antes y después)
// Imprime una tabla y guarda docs/previews/web/rendimiento[-etiqueta].json. Con el 3D por software los números solo sirven
// para comprobar que la herramienta funciona: el dato que importa es el de tu equipo, con --ventana.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const valor = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const argumento = (nombre, defecto) => Number(valor(nombre) ?? defecto)
const lista = (nombre, defecto) => (valor(nombre) ?? defecto).split(',').filter(Boolean)
const PNJ = argumento('pnj', 16)
const SEGUNDOS = argumento('segundos', 10)
const VENTANA = process.argv.includes('--ventana')
const SIN_LIMITE = process.argv.includes('--sin-limite')
const ANOCHECER = process.argv.includes('--anochecer')
const HORA = valor('hora')
const ETIQUETA = valor('etiqueta')
const CALIDADES = lista('calidades', 'baja,media,alta')
const [ANCHO, ALTO] = (valor('resolucion') ?? '1280x720').split('x').map(Number)
// la plaza junto al parque (donde más se ve) y la acera exterior de una manzana del borde (media vista es cielo y niebla)
// (las coordenadas salen del barrio cargado, ver más abajo)
const SITIOS = { centro: null, borde: null }
const sitios = lista('sitios', 'centro')
for (const sitio of sitios) if (!(sitio in SITIOS)) throw new Error(`Sitio desconocido: ${sitio} (usa ${Object.keys(SITIOS).join(', ')})`)
if (HORA && !/^\d\d:\d\d$/.test(HORA)) throw new Error('--hora debe ser HH:MM')
// siempre el mismo día y huso, para que la hora signifique lo mismo en cualquier equipo
const fecha = (hora) => `2025-06-21T${hora}:00+02:00`

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
if (SIN_LIMITE) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit')
const browser = await chromium.launch({ headless: !VENTANA, args })
const page = await browser.newPage({ viewport: { width: ANCHO, height: ALTO } })
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
await page.waitForFunction((n) => { const s = window.__world().stats(); return s.npcs.loaded >= n && s.scenery.lamps }, PNJ, { timeout: 480000 })
// se deja que las calles se animen un poco antes de medir
await page.evaluate(() => window.__world().advance(30))
Object.assign(SITIOS, await page.evaluate(() => {
  const { spawn, nav } = window.__world().layout
  return { centro: [spawn.x, spawn.z], borde: [Math.max(...nav.filter((n) => Math.abs(n.z) < 1e-9).map((n) => n.x)), 0] }
}))

const filas = []
for (const sitio of sitios) {
  for (const calidad of CALIDADES) {
    await page.evaluate(([q, [x, z], hora]) => {
      const w = window.__world()
      w.setQuality(q)
      if (hora) w.setClockOverride(hora)
      // el protagonista corre en círculos, con la cámara girando: el mismo recorrido en cada calidad
      w.teleport(x, z, 0)
      w.inputOverride = { moveX: 1, moveZ: 0.3, run: true }
    }, [calidad, SITIOS[sitio], HORA ? fecha(HORA) : null])
    await page.waitForTimeout(2500) // deja asentarse el cambio (y compilar los materiales si cambian las luces)
    await page.evaluate(() => window.__world().resetDiagnostics())
    const inicio = Date.now()
    while (Date.now() - inicio < SEGUNDOS * 1000) {
      await page.evaluate(([x, z]) => {
        const w = window.__world()
        const s = w.stats()
        // si se aleja del sitio, vuelve
        if (Math.hypot(s.player.x - x, s.player.z - z) > 14) w.teleport(x, z, 0)
        w.orbitCamera(s.cameraYaw + 0.2, 0.3, 4.6)
      }, SITIOS[sitio])
      await page.waitForTimeout(500)
    }
    const fila = await page.evaluate(() => {
      const w = window.__world()
      const s = w.stats()
      return { ...w.performance(), night: s.clock.night, gameTime: s.gameTime, lights: s.streetLights.active }
    })
    filas.push({ ...fila, sitio })
    console.log(`medido: ${sitio} · ${calidad} · ${fila.night ? 'noche' : 'día'} · ${fila.fps.toFixed(0)} FPS`)
  }
}

// al anochecer y al amanecer: el peor fotograma mientras se encienden o se apagan las farolas. Se mide «en frío», como
// quien empezó a jugar de día: se sueltan los materiales compilados y solo se vuelven a compilar los del momento de antes
let anochecer = null
if (ANOCHECER) {
  const cambio = (base, buscaNoche) => page.evaluate(([b, noche]) => {
    const w = window.__world()
    const inicio = Date.parse(b)
    for (let minuto = 0; minuto < 8 * 60; minuto++) {
      w.setClockOverride(new Date(inicio + minuto * 60000).toISOString())
      if (w.stats().clock.night === noche) return new Date(inicio + minuto * 60000).toISOString()
    }
    return null
  }, [base, buscaNoche])
  const momentos = [
    { nombre: 'anochecer', momento: await cambio(fecha('19:00'), true), noche: true },
    { nombre: 'amanecer', momento: await cambio(fecha('03:00'), false), noche: false },
  ]
  anochecer = []
  for (const { nombre, momento, noche } of momentos) {
    if (!momento) throw new Error(`No se encontró el ${nombre}`)
    for (const calidad of CALIDADES) {
      await page.evaluate(([q, [x, z], antes]) => {
        const w = window.__world()
        w.setQuality(q)
        w.setClockOverride(antes)
        w.teleport(x, z, 0)
        w.inputOverride = { moveX: 1, moveZ: 0.3, run: true }
        // en frío: fuera los programas compilados; el siguiente fotograma solo compila los de este momento
        w.scene.traverse((object) => {
          const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []
          for (const material of materials) material.dispose()
        })
      }, [calidad, SITIOS[sitios[0]], new Date(Date.parse(momento) - 6 * 60000).toISOString()])
      await page.waitForTimeout(2000)
      // el reloj avanza un minuto por segundo: el cambio llega a los ~4 s de medir
      await page.evaluate(() => window.__world().resetDiagnostics())
      await page.waitForTimeout(8000)
      const r = await page.evaluate(() => {
        const w = window.__world()
        return { ...w.performance(), night: w.stats().clock.night, lit: w.stats().streetLights.active }
      })
      if (r.night !== noche) throw new Error(`La medición del ${nombre} terminó antes del cambio`)
      anochecer.push({ momento: nombre, calidad, worstMs: r.worstMs, p99Ms: r.p99Ms, fps: r.fps })
      console.log(`${nombre}: ${calidad} · peor fotograma ${r.worstMs.toFixed(0)} ms`)
    }
  }
}

await page.evaluate(() => (window.__world().inputOverride = null))
await browser.close()
// en Windows se mata todo el árbol (npx y vite) antes que nada: matando primero el intérprete, vite quedaba huérfano
if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
else server.kill()

const tabla = [
  '| Sitio | Calidad | Hora | FPS | ms/fotograma | 1 % más lento | peor | Luces | Resolución | Triángulos | Llamadas |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...filas.map((f) => `| ${f.sitio} | ${f.quality} | ${f.gameTime}${f.night ? ' (noche)' : ''} | ${f.fps.toFixed(0)} | ${f.avgMs.toFixed(1)} | ${f.p99Ms.toFixed(1)} ms | ${f.worstMs.toFixed(1)} ms | ${f.lights} | ${f.width}×${f.height} | ${f.triangles.toLocaleString('es')} | ${f.calls} |`),
].join('\n')
const tablaAnochecer = anochecer
  ? `\n\nAl encenderse y apagarse las farolas (peor fotograma, en frío):\n\n| Momento | Calidad | Peor | 1 % más lento |\n|---|---|---|---|\n${anochecer.map((a) => `| ${a.momento} | ${a.calidad} | ${a.worstMs.toFixed(0)} ms | ${a.p99Ms.toFixed(0)} ms |`).join('\n')}`
  : ''
// sin tope, Chromium encola fotogramas y cada ~150 ms da uno de ~100 ms aunque no pase nada: los FPS medios valen, los tirones no
const aviso = SIN_LIMITE ? '\nAviso: con --sin-limite los FPS medios son fiables, pero el 1 % más lento y el peor no (mide los tirones sin esa opción).' : ''
console.log(`\nVecinos: ${filas[0].npcs} · ${SEGUNDOS} s por medida · ${VENTANA ? 'tarjeta gráfica real' : 'dibujado por software (SwiftShader)'}${SIN_LIMITE ? ' · sin tope de FPS' : ''}\nTarjeta: ${filas[0].gpu}${aviso}\n\n${tabla}${tablaAnochecer}\n`)
const archivo = `rendimiento${ETIQUETA ? `-${ETIQUETA}` : ''}.json`
fs.writeFileSync(path.join(OUT, archivo), JSON.stringify({ fecha: new Date().toISOString(), ventana: VENTANA, sinLimite: SIN_LIMITE, hora: HORA ?? null, filas, anochecer }, null, 2))
process.exit(0)
