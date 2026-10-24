// Capturas del barrio jugable para revisar a simple vista la zancada, la ciudad y lo que hacen los PNJ.
// Uso: npm run build && node tools/revision/mundo.mjs <marcha|calle|parque|ciclo|pnj|sentado> [cuerpo]
//   marcha: tira de fotogramas de un paso andando y corriendo (vista de perfil)
//   calle:  vista general del barrio tras unos minutos de simulación
//   parque: fuente, árboles y farolas de Blender a escala de juego
//   ciclo:  vistas del parque de día y de noche con el reloj fijado, y la iluminación cerca, en una calle, a lo lejos
//           y desde arriba, con el brillo medio de cada vista (--etiqueta=antes añade un sufijo a las capturas)
//   pnj:    un PNJ de cada actividad (sentado, charlando, mirando un escaparate, esperando...)
// Las imágenes salen en docs/previews/web/mundo-*.png
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const posicionales = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const scenario = posicionales[0] ?? 'calle'
const body = posicionales[1] ?? 'marcos'
// --etiqueta=antes: las capturas de ciclo salen con ese sufijo, para comparar antes y después de un cambio
const etiqueta = process.argv.find((a) => a.startsWith('--etiqueta='))?.split('=')[1]
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

const errors = []
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
page.on('console', (message) => ['error', 'warning'].includes(message.type()) && errors.push(`${message.type()}: ${message.text()}`))
page.on('pageerror', (error) => errors.push(error.message))
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
if (scenario === 'pnj-sentado') {
  await page.addInitScript(() => { window.__WORLD_NPC_LIMIT__ = 4 })
}

const save = {
  version: 2,
  characters: [{ id: 'a', name: 'Revisión', spec: { cuerpo: body } }],
  activeId: 'a',
  difficulty: 'equilibrada',
  settings: { masterVolume: 80, musicVolume: 65, effectsVolume: 80, controlPreset: 'clasico', subtitles: true, highContrast: false, reducedMotion: false, largeText: false },
}
await page.addInitScript((value) => localStorage.setItem('entrecalles-save-v2', JSON.stringify(value)), save)
await page.goto(`http://localhost:${PORT}/#/jugar`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120000 })
if (scenario === 'parque' || scenario === 'ciclo') {
  await page.waitForFunction(() => {
    const scenery = window.__world().stats().scenery
    return scenery.fountain && scenery.trees && scenery.lamps && scenery.sun && scenery.moon
  }, null, { timeout: 120000 })
}
if (scenario === 'pnj' || scenario === 'pnj-sentado' || scenario === 'calle') {
  await page.waitForFunction(() => { const n = window.__world().stats().npcs; return n.total > 0 && n.loaded === n.total }, null, { timeout: 240000 })
}
// se congela el bucle: a partir de aquí la simulación avanza solo con advance() y se dibuja con renderNow()
await page.evaluate(() => window.__world().setPaused(true))
// se oculta la interfaz para ver solo la escena
await page.addStyleTag({ content: '.world-bar,.world-help,.world-toast,.world-sound-hint,.world-prompt{display:none!important}' })

const shot = async (name) => {
  await page.evaluate(() => window.__world().renderNow())
  const file = path.join(OUT, `mundo-${name}.png`)
  await page.screenshot({ path: file })
  console.log(file)
}

if (scenario === 'marcha') {
  for (const [name, run, step] of [['anda', false, 0.13], ['corre', true, 0.085]]) {
    await page.evaluate((r) => {
      const w = window.__world()
      w.teleport(0, w.layout.spawn.z, 0) // la acera junto al parque
      w.orbitCamera(0, 0.12, 3.4)
      w.inputOverride = { moveX: 1, moveZ: 0, run: r } // hacia la derecha de la pantalla: se ve de perfil
      w.advance(1.5)
    }, run)
    for (let i = 0; i < 8; i++) {
      await page.evaluate((dt) => window.__world().advance(dt), step)
      await shot(`marcha-${name}-${i}`)
    }
  }
} else if (scenario === 'tienda') {
  // la fachada del café con la puerta cerrada, abriéndose y los bancos de Blender
  await page.evaluate(() => {
    const w = window.__world()
    const d = w.stats().door
    w.cameraClip = false
    w.teleport(d.x, d.z - 9, 0)
    w.orbitCamera(Math.PI, 0.1, 5.5)
    w.advance(0.3)
  })
  await shot('tienda-cerrada')
  await page.evaluate(() => { const w = window.__world(); const d = w.stats().door; w.teleport(d.x, d.z - 1.5, Math.PI); w.orbitCamera(0.4, 0.15, 4.5); w.advance(1.2) })
  await shot('tienda-abierta')
  await page.evaluate(() => { const w = window.__world(); const d = w.stats().door; w.teleport(d.x + 5, d.z - 6, Math.PI); w.orbitCamera(-0.6, 0.3, 9); w.advance(0.3) })
  await shot('tienda-calle')
  await page.evaluate(() => {
    const w = window.__world()
    const b = w.layout.benches.find((x) => Math.abs(x.x) > 16 || Math.abs(x.z) > 16)
    w.teleport(b.x + Math.sin(b.yaw) * 2.2, b.z + Math.cos(b.yaw) * 2.2, b.yaw + Math.PI)
    w.orbitCamera(b.yaw + 0.5, 0.2, 3.2)
    w.advance(0.2)
  })
  await shot('banco')
} else if (scenario === 'interior') {
  // entra en el café por la puerta y mira la sala desde varios puntos
  await page.evaluate(() => {
    const w = window.__world()
    const d = w.stats().door
    w.teleport(d.x, d.z - 0.9, Math.PI)
    w.advance(0.3)
    w.interact()
  })
  for (let i = 0; i < 60; i++) {
    const modo = await page.evaluate(() => { window.__world().advance(0.2); return window.__world().stats().mode })
    if (modo === 'interior') break
    await page.waitForTimeout(100)
  }
  await page.evaluate(() => window.__world().advance(1))
  await shot('interior-entrada')
  await page.evaluate(() => { const w = window.__world(); w.cameraClip = false; w.teleport(0, 400 + 3.5, 0); w.orbitCamera(Math.PI * 0.9, 0.9, 10); w.advance(0.3) })
  await shot('interior-alto')
  await page.evaluate(() => { const w = window.__world(); w.teleport(1.8, 400 + 4.8, 0.5); w.orbitCamera(2.6, 0.25, 3.5); w.advance(0.3) })
  await shot('interior-mesas')
  await page.evaluate(() => { const w = window.__world(); w.cameraClip = true; w.teleport(-1.0, 400 + 4.4, Math.PI / 2); w.orbitCamera(-1.2, 0.3, 3.8); w.advance(0.3) })
  await shot('interior-mostrador')
} else if (scenario === 'ciclo') {
  await page.evaluate(() => {
    const w = window.__world()
    w.cameraClip = false
    w.teleport(0, 0, 0)
    w.focusOverride = { x: 0, z: 8 }
    w.setClockOverride('2025-06-21T12:00:00+02:00')
    const azimuth = (w.stats().clock.sunAzimuth * Math.PI) / 180
    w.orbitCamera(azimuth + Math.PI, -1.15, 2.2)
  })
  await shot('ciclo-dia')
  await page.evaluate(() => {
    const w = window.__world()
    w.setClockOverride('2025-12-21T00:00:00+01:00')
    w.orbitCamera((w.stats().clock.sunAzimuth * Math.PI) / 180, -1.15, 2.2)
  })
  await shot('ciclo-noche')

  // la iluminación de cerca, a lo largo de una calle, a lo lejos y desde arriba, de día y de noche (con su brillo medio)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.evaluate(() => {
    const w = window.__world()
    w.focusOverride = null
    w.cameraClip = true
  })
  const vistas = {
    // junto a la farola más cercana a la plaza
    cerca: () => {
      const w = window.__world()
      const z = w.layout.spawn.z
      const lamp = [...w.layout.lamps].sort((a, b) => Math.hypot(a.x, a.z - z) - Math.hypot(b.x, b.z - z))[0]
      w.teleport(lamp.x + 1.4, lamp.z + 1.4, 0)
      w.orbitCamera(0.8, 0.22, 5)
    },
    // desde un cruce, a lo largo de la calle hasta el borde (~45 m)
    calle: () => {
      const w = window.__world()
      // el centro de un cruce: los pasos de peatones de las calles norte-sur están en el eje de la calle
      const half = Math.abs(w.layout.crossings.find((c) => c.alongX).x)
      w.teleport(half, half, 0)
      w.orbitCamera(-Math.PI / 2, 0.12, 5)
    },
    // desde la plaza hacia la manzana sur y la calle del borde (~50 m), casi a ras de suelo
    lejos: () => {
      const w = window.__world()
      w.teleport(0, w.layout.spawn.z, 0) // la acera junto al parque
      w.orbitCamera(Math.PI, 0.05, 4)
    },
    general: () => {
      const w = window.__world()
      w.cameraClip = false
      w.teleport(0, 0, 0)
      w.orbitCamera(0.6, 0.8, 120)
    },
  }
  const brillos = []
  for (const [momento, hora] of [['dia', '2025-06-21T13:00:00+02:00'], ['noche', '2025-06-21T23:30:00+02:00']]) {
    for (const [vista, colocar] of Object.entries(vistas)) {
      await page.evaluate((h) => {
        const w = window.__world()
        w.cameraClip = true
        w.setClockOverride(h)
      }, hora)
      await page.evaluate(colocar)
      // las luces cercanas se recolocan al mover al protagonista
      await page.evaluate(() => window.__world().advance(0.5))
      const brillo = await page.evaluate(() => {
        // se dibuja y se lee en el mismo paso, antes de que el navegador vacíe el lienzo
        window.__world().renderNow()
        const source = document.querySelector('.world-canvas canvas')
        const copy = document.createElement('canvas')
        copy.width = 160
        copy.height = 90
        const context = copy.getContext('2d')
        context.drawImage(source, 0, 0, copy.width, copy.height)
        const { data } = context.getImageData(0, 0, copy.width, copy.height)
        const media = (desde, hasta) => {
          let sum = 0
          let n = 0
          for (let y = Math.floor(copy.height * desde); y < Math.floor(copy.height * hasta); y++) {
            for (let x = 0; x < copy.width; x++) {
              const i = (y * copy.width + x) * 4
              sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
              n++
            }
          }
          return sum / n
        }
        // la franja central es lo que está a media y larga distancia
        return { total: media(0, 1), franja: media(0.35, 0.65) }
      })
      brillos.push({ momento, vista, total: Math.round(brillo.total), franja: Math.round(brillo.franja) })
      await shot(`ciclo-${vista}-${momento}${etiqueta ? `-${etiqueta}` : ''}`)
    }
  }
  console.table(brillos)
  fs.writeFileSync(path.join(OUT, `mundo-ciclo-brillo${etiqueta ? `-${etiqueta}` : ''}.json`), JSON.stringify(brillos, null, 2))
} else if (scenario === 'parque') {
  await page.evaluate(() => {
    const w = window.__world()
    w.cameraClip = false
    w.teleport(20, 20, 0)
    w.focusOverride = { x: 0, z: 0 }
    w.orbitCamera(0.65, 0.35, 8)
  })
  await shot('parque-detalle')
  await page.evaluate(() => {
    const w = window.__world()
    w.orbitCamera(0.65, 0.65, 17)
  })
  await shot('parque-general')
} else if (scenario === 'sentado') {
  // el protagonista usa una plaza real del banco y completa la transición de sentarse
  const seat = await page.evaluate(() => {
    const w = window.__world()
    const bench = w.layout.benches.find((b) => Math.abs(b.x) > 16 || Math.abs(b.z) > 16)
    const seat = w.seats.find((candidate) => Math.hypot(candidate.x - bench.x, candidate.z - bench.z) < 0.6)
    if (!seat) throw new Error('No se encontró plaza de asiento junto al banco')
    w.teleport(seat.approach.x, seat.approach.z, seat.yaw)
    w.advance(0.1)
    w.interact()
    w.advance(1.2)
    if (!w.stats().player.seated) throw new Error('El protagonista no terminó de sentarse en el banco')
    window.__banco = bench
    return seat
  })
  console.log(JSON.stringify(await page.evaluate(() => ({
    banco: window.__banco,
    jugador: window.__world().stats().player,
    huesos: window.__world().playerBones(['pelvis', 'spine_03', 'head', 'thigh_l', 'calf_l', 'foot_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r']),
  })), null, 1))
  for (const [name, yaw, pitch] of [['frente', 0, 0.12], ['lado', 1.57, 0.1], ['atras', 3.14, 0.2], ['alto', 0.6, 0.7]]) {
    await page.evaluate(([s, y, p]) => {
      const w = window.__world()
      w.cameraClip = false
      w.orbitCamera(s.yaw + y, p, 3.2)
    }, [seat, yaw, pitch])
    await shot(`sentado-${name}`)
  }
} else if (scenario === 'calle') {
  await page.evaluate(() => {
    const w = window.__world()
    w.advance(90)
    // en el centro de la calle al sur del parque, mirando a lo largo de ella; luego, en un cruce
    const half = Math.abs(w.layout.crossings.find((c) => c.alongX).x)
    w.teleport(0, half, 0)
    w.orbitCamera(Math.PI, 0.3, 8)
  })
  await shot('calle-1')
  await page.evaluate(() => {
    const w = window.__world()
    const half = Math.abs(w.layout.crossings.find((c) => c.alongX).x)
    w.teleport(half, half, 0)
    w.orbitCamera(0.8, 0.35, 9)
  })
  await shot('calle-2')
  await page.evaluate(() => { const w = window.__world(); w.cameraClip = false; w.teleport(0, 0, 0); w.orbitCamera(0.6, 0.8, 120) })
  await shot('calle-3')
} else if (scenario === 'pnj-sentado') {
  let sitter = null
  for (let i = 0; i < 80; i++) {
    sitter = await page.evaluate(() => {
      const w = window.__world()
      w.advance(5)
      return w.stats().npcs.list.find((npc) => npc.sit > 0.95) ?? null
    })
    if (sitter) break
  }
  if (!sitter) throw new Error('Ningún PNJ llegó a sentarse en los bancos durante la simulación')
  await page.evaluate((npc) => {
    const w = window.__world()
    const actor = w.npcActors.find((candidate) => candidate.id === npc.id)
    w.focusOverride = { x: npc.x, z: npc.z }
    w.teleport(npc.x + 30, npc.z + 30, 0)
    w.orbitCamera(actor?.brain.yaw ?? 0, 0.18, 3.6)
  }, sitter)
  await shot('pnj-sentado')
} else if (scenario === 'pnj') {
  // se deja pasar el tiempo hasta que haya alguien sentado, otro esperando, otro mirando un escaparate y una pareja charlando
  for (let i = 0; i < 60; i++) {
    const done = await page.evaluate(() => {
      const w = window.__world()
      w.advance(5)
      const list = w.stats().npcs.list
      const haciendo = (actividad) => list.some((n) => n.activity === actividad && n.doing && n.speed === 0)
      return list.some((n) => n.sit > 0.95) && haciendo('esperar') && haciendo('escaparate') && list.filter((n) => n.activity === 'charlar' && n.doing).length >= 2
    })
    if (done) break
  }
  const rendimiento = await page.evaluate(() => { const { fps, calls, triangles, geometries, textures } = window.__world().stats(); return { fps, calls, triangles, geometries, textures } })
  console.log('Render:', JSON.stringify(rendimiento))
  const list = await page.evaluate(() => window.__world().stats().npcs.list)
  const seen = new Set()
  for (const npc of list) {
    const interesting = (npc.activity === 'sentarse' && npc.sit > 0.95) || (npc.doing && npc.activity !== 'pasear' && npc.activity !== 'correr') || npc.activity === 'correr'
    if (!interesting || seen.has(npc.activity)) continue
    seen.add(npc.activity)
    await page.evaluate((n) => {
      const w = window.__world()
      w.focusOverride = { x: n.x, z: n.z }
      w.teleport(n.x + 30, n.z + 30, 0) // el protagonista se aparta
      w.orbitCamera(1.1, 0.18, 3.6)
    }, npc)
    await shot(`pnj-${npc.activity}`)
    await page.evaluate(() => window.__world().orbitCamera(2.4, 0.18, 3.6))
    await shot(`pnj-${npc.activity}-lado`)
  }
}

await browser.close()
// en Windows se mata todo el árbol (npx y vite) antes que nada: matando primero el intérprete, vite quedaba huérfano
if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
else server.kill()
console.log(errors.length ? `Errores:\n${errors.join('\n')}` : 'Sin errores de consola')
process.exit(0) // el servidor deja tuberías abiertas: sin esto el proceso no termina
