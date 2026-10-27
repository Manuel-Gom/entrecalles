// Capturas del barrio jugable para revisar a simple vista la zancada, la ciudad y lo que hacen los PNJ.
// Uso: npm run build && node tools/revision/mundo.mjs <marcha|calle|parque|ciclo|pnj|sentado> [cuerpo]
//   marcha: tira de fotogramas de un paso andando y corriendo (vista de perfil); --carrera=corre-media y --andar=anda-prisa prueban otras animaciones
//   manos:  primeros planos de las manos andando y corriendo, por los dos lados
//   calle:  vista general del barrio tras unos minutos de simulación
//   parque: fuente, árboles y farolas de Blender a escala de juego
//   ciclo:  vistas del parque de día y de noche con el reloj fijado, y la iluminación cerca, en una calle, a lo lejos
//           y desde arriba, con el brillo medio de cada vista (--etiqueta=antes añade un sufijo a las capturas)
//   puertas: el portal de un edificio (pasar por delante, llegar andando y corriendo, salir) y llamar al ascensor; deja mundo-puertas.json
//   horario: cuánta gente hay en la calle a varias horas y un dependiente en su local; deja mundo-horario.json
//   lejos:  un local a 30 m (interior pintado) de día, de noche y cerrado, y a qué distancia se ven los vecinos
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
// --carrera=corre-media: otra animación de correr (las capturas de marcha llevan su nombre)
const carrera = process.argv.find((a) => a.startsWith('--carrera='))?.split('=')[1]
// --andar=anda-prisa: otra animación de andar (igual, con su nombre en las capturas)
const andar = process.argv.find((a) => a.startsWith('--andar='))?.split('=')[1]
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
if (carrera) await page.addInitScript((value) => { window.__WORLD_RUN_CLIP__ = value }, carrera)
if (andar) await page.addInitScript((value) => { window.__WORLD_WALK_CLIP__ = value }, andar)
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
  // las animaciones llegan después del personaje: sin ellas se vería la zancada calculada
  await page.waitForFunction(() => window.__world().stats().player.motion !== null, null, { timeout: 60000 }).catch(() => console.log('Sin animaciones: zancada calculada'))
  console.log('Animaciones:', JSON.stringify(await page.evaluate(() => window.__world().stats().player.motion)))
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
      await shot(`marcha-${name}${carrera && name === 'corre' ? '-' + carrera : ''}${andar && name === 'anda' ? '-' + andar : ''}-${i}`)
    }
  }
} else if (scenario === 'manos') {
  // primer plano de las manos andando y corriendo, por los dos lados (la mano cercana a la cámara se ve entera)
  await page.waitForFunction(() => window.__world().stats().player.motion !== null, null, { timeout: 60000 }).catch(() => console.log('Sin animaciones: zancada calculada'))
  for (const [name, run, step] of [['anda', false, 0.11], ['corre', true, 0.07]]) {
    for (const [side, moveX] of [['der', 1], ['izq', -1]]) {
      await page.evaluate(([r, m]) => {
        const w = window.__world()
        w.teleport(0, w.layout.spawn.z, 0)
        w.orbitCamera(0, 0.5, 1.7)
        w.inputOverride = { moveX: m, moveZ: 0, run: r }
        w.advance(1.5)
      }, [run, moveX])
      for (let i = 0; i < 4; i++) {
        await page.evaluate((dt) => window.__world().advance(dt), step)
        await shot(`manos-${name}-${side}-${i}`)
      }
    }
  }
} else if (scenario === 'puertas') {
  // el portal de un edificio: pasar por delante (no se abre), llegar andando y corriendo (se empuja con la mano) y salir
  // por dentro; luego llamar al ascensor desde un rellano, quedarse en el umbral y subir. Deja un JSON con lo medido.
  await page.waitForFunction(() => window.__world().stats().building.ready, null, { timeout: 60000 })
  const registro = {}
  const pasada = async (nombre, { desde, por = 0, moveX = 0, moveZ = 0, run = false, frames, step, camara, fotos = true }) => {
    await page.evaluate(([b, desde, por, camara]) => {
      const w = window.__world()
      const p = w.layout.buildings[b].portal
      const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw)
      w.teleport(p.x + nx * desde + nz * por, p.z + nz * desde - nx * por, p.yaw)
      w.orbitCamera(p.yaw + camara[0], camara[1], camara[2])
      w.inputOverride = { moveX: 0, moveZ: 0, run: false }
      w.advance(2.5)
    }, [edificio, desde, por, camara])
    const datos = []
    for (let i = 0; i < frames; i++) {
      datos.push(await page.evaluate(([b, step, mx, mz, run]) => {
        const w = window.__world()
        w.inputOverride = { moveX: mx, moveZ: mz, run }
        w.advance(step)
        const s = w.stats()
        const p = w.layout.buildings[b].portal
        const across = (s.player.x - p.x) * Math.sin(p.yaw) + (s.player.z - p.z) * Math.cos(p.yaw)
        const door = s.building.doors.find((d) => d.building === b && Math.hypot(d.x - p.x, d.z - p.z) < 1.5)
        return { across: +across.toFixed(2), speed: +s.player.speed.toFixed(2), open: door ? +door.open.toFixed(2) : 0, side: door?.side ?? 0, push: s.building.push ? +s.building.push.weight.toFixed(2) : 0, hand: s.building.push?.hand ?? null }
      }, [edificio, step, moveX, moveZ, run]))
      if (fotos) await shot(`puertas-${nombre}-${i}`)
    }
    registro[nombre] = datos
    console.log(nombre, JSON.stringify(datos.map((d) => [d.across, d.open, d.push, d.hand])))
  }
  // un edificio con ascensor, para usar el mismo en todo
  const edificio = await page.evaluate(() => window.__world().layout.buildings.findIndex((b) => b.floors >= 5 && b.shop.kind !== 'cafe'))
  // de lado, mirando la fachada: moveX = 1 va hacia la puerta
  const lado = [Math.PI / 2, 0.12, 3.6]
  await pasada('acera', { desde: 1.1, por: 5, moveZ: 1, frames: 8, step: 0.9, camara: [Math.PI / 2, 0.35, 7], fotos: false })
  await pasada('anda', { desde: 3.5, moveX: 1, frames: 16, step: 0.15, camara: lado })
  await pasada('corre', { desde: 7, moveX: 1, run: true, frames: 16, step: 0.1, camara: lado })
  await pasada('sale', { desde: -3, moveX: 1, frames: 16, step: 0.15, camara: [-Math.PI / 2, 0.12, 3.6] })
  // primeros planos de la mano: entrando (derecha) y saliendo (izquierda), sin que los muros aparten la cámara
  await page.evaluate(() => { window.__world().cameraClip = false })
  await pasada('mano', { desde: 1.5, moveX: 0.9, moveZ: -0.435, frames: 12, step: 0.08, camara: [Math.PI / 2 + 0.45, 0.15, 1.7] })
  await pasada('mano-sale', { desde: -1.5, moveX: 0.9, moveZ: 0.435, frames: 12, step: 0.08, camara: [-Math.PI / 2 - 0.45, 0.15, 1.7] })
  // el ascensor: al rellano de la segunda planta, delante de su puerta
  const ascensor = await page.evaluate((b) => {
    const w = window.__world()
    const p = w.layout.buildings[b].portal
    w.teleport(p.x - Math.sin(p.yaw) * 2, p.z - Math.cos(p.yaw) * 2, p.yaw)
    w.advance(0.5)
    const e = w.stats().building.elevator
    if (!e) return null
    const { door } = e
    const y = 0.05 + 2 * 3
    w.teleport(door.x + Math.sin(door.yaw) * 1.1, door.z + Math.cos(door.yaw) * 1.1, door.yaw, y)
    w.orbitCamera(door.yaw + 0.7, 0.25, 3.2)
    w.advance(0.5)
    const pasos = [{ fase: 'rellano', prompt: w.stats().prompt ?? null, ...w.stats().building.elevator }]
    w.interact()
    for (let i = 0; i < 8; i++) {
      w.advance(0.5)
      const { state, level, y: cabina, doors, called } = w.stats().building.elevator
      pasos.push({ fase: 'llamado', state, level, cabina: +cabina.toFixed(2), doors, called })
    }
    // al umbral: la puerta no se cierra aunque pase el tiempo
    w.teleport(door.x - Math.sin(door.yaw) * 0.05, door.z - Math.cos(door.yaw) * 0.05, door.yaw + Math.PI, y)
    for (let i = 0; i < 6; i++) {
      w.advance(1)
      const { state, doors } = w.stats().building.elevator
      pasos.push({ fase: 'umbral', state, doors })
    }
    // y al salir del umbral, se cierra
    w.teleport(door.x + Math.sin(door.yaw) * 1.5, door.z + Math.cos(door.yaw) * 1.5, door.yaw, y)
    w.advance(5)
    pasos.push({ fase: 'fuera', ...w.stats().building.elevator })
    return pasos
  }, edificio)
  registro.ascensor = ascensor
  console.log('ascensor', JSON.stringify(ascensor))
  await shot('puertas-ascensor')
  fs.writeFileSync(path.join(OUT, 'mundo-puertas.json'), JSON.stringify(registro, null, 1))
} else if (scenario === 'horario') {
  // cuánta gente hay en la calle a lo largo del día, qué hace, y un dependiente en su local
  await page.waitForFunction(() => window.__world().stats().npcs.loaded >= window.__world().stats().npcs.total && window.__world().stats().building.ready, null, { timeout: 120000 })
  const resumen = {}
  for (const hora of ['03:00', '07:30', '10:00', '13:00', '18:00', '21:00', '23:30']) {
    resumen[hora] = await page.evaluate((hora) => {
      const w = window.__world()
      w.setClockOverride(`2025-06-21T${hora}:00+02:00`)
      for (let i = 0; i < 90; i++) w.advance(1)
      const list = w.stats().npcs.list
      const count = {}
      for (const npc of list) count[npc.activity] = (count[npc.activity] ?? 0) + 1
      return { calle: list.filter((n) => !n.hidden && n.building < 0).length, casa: list.filter((n) => n.hidden).length, dentro: list.filter((n) => n.building >= 0 && !n.hidden).length, actividades: count }
    }, hora)
    console.log(hora, JSON.stringify(resumen[hora]))
  }
  // a media mañana, al lado de un dependiente: se monta su edificio y se le ve dentro
  const dependiente = await page.evaluate(() => {
    const w = window.__world()
    w.setClockOverride('2025-06-21T11:00:00+02:00')
    for (let i = 0; i < 60; i++) w.advance(1)
    const npc = w.stats().npcs.list.find((n) => n.activity === 'trabajar' && n.building >= 0)
    if (!npc) return null
    const b = w.layout.buildings[npc.building]
    const d = b.shop.door
    // el protagonista a un lado, para no tapar el local
    w.teleport(d.x + Math.sin(d.yaw) * 2.5 - Math.cos(d.yaw) * 3, d.z + Math.cos(d.yaw) * 2.5 + Math.sin(d.yaw) * 3, d.yaw + Math.PI)
    w.orbitCamera(d.yaw - 0.5, 0.2, 5)
    w.advance(1.5)
    const st = w.stats()
    return { ...npc, visible: st.npcs.list.find((n) => n.id === npc.id).visible, kind: b.shop.kind, door: d, activo: st.building.active, jugador: [st.player.x, st.player.z] }
  })
  console.log('dependiente', JSON.stringify(dependiente))
  await shot('horario-dependiente')
  fs.writeFileSync(path.join(OUT, 'mundo-horario.json'), JSON.stringify({ resumen, dependiente }, null, 1))
} else if (scenario === 'lejos') {
  // los escaparates de un local a 30 m (sin montar su edificio: el interior pintado) de día y de noche, y los vecinos
  // de lejos (cuántos se ven y a qué distancia)
  await page.waitForFunction(() => window.__world().stats().building.ready && window.__world().stats().npcs.loaded >= window.__world().stats().npcs.total, null, { timeout: 120000 })
  for (const [momento, hora] of [['dia', '13:00'], ['noche', '21:00'], ['cerrado', '23:30']]) {
    const info = await page.evaluate((hora) => {
      const w = window.__world()
      w.setClockOverride(`2025-06-21T${hora}:00+02:00`)
      const b = w.layout.buildings.find((x) => x.shop.kind === 'farmacia')
      const d = b.shop.door
      w.teleport(d.x + Math.sin(d.yaw) * 30, d.z + Math.cos(d.yaw) * 30, d.yaw + Math.PI)
      w.orbitCamera(d.yaw, 0.08, 4)
      for (let i = 0; i < 10; i++) w.advance(0.3)
      const s = w.stats()
      const lejos = s.npcs.list.filter((n) => n.visible).map((n) => Math.round(Math.hypot(n.x - s.player.x, n.z - s.player.z)))
      return { activo: s.building.active, visibles: lejos.sort((a, b) => a - b) }
    }, hora)
    console.log(momento, JSON.stringify(info))
    await shot(`lejos-${momento}`)
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
