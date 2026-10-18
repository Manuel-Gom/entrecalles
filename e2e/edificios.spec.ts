import type { Page } from '@playwright/test'
import { expect, test, withCharacters } from './fixtures'

/** Abre el barrio sin vecinos y espera a que estén el protagonista y los modelos de Blender. */
async function entrar(page: Page) {
  await page.addInitScript(() => {
    window.__WORLD_NPC_LIMIT__ = 0
  })
  await page.goto('/#/jugar')
  await page.waitForFunction(
    () => {
      const s = window.__world?.()?.stats()
      return Boolean(
        s &&
          s.state === 'listo' &&
          s.scenery.benches &&
          s.scenery.storefront &&
          s.scenery.fountain &&
          s.scenery.trees &&
          s.scenery.lamps &&
          s.scenery.sun &&
          s.scenery.moon,
      )
    },
    null,
    { timeout: 120_000 },
  )
}

const stats = (page: Page) => page.evaluate(() => window.__world!()!.stats())

/** Se pone delante de la puerta del café y entra con la tecla de interactuar. */
async function entrarAlCafe(page: Page) {
  await page.evaluate(() => {
    const w = window.__world!()!
    const d = w.stats().door!
    w.teleport(d.x, d.z - 0.9, Math.PI) // la fachada mira hacia -Z
  })
  await page.waitForFunction(() => window.__world!()!.stats().prompt === 'entrar', null, { timeout: 30_000 })
  await page.keyboard.press('KeyE')
  await page.waitForFunction(() => window.__world!()!.stats().mode === 'interior' && !window.__world!()!.stats().transitioning, null, { timeout: 90_000 })
}

test.describe('edificios: la puerta del café y su interior', () => {
  test('la fachada y la decoración del parque se cargan de Blender y la puerta se abre al acercarse', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    expect((await stats(page)).scenery).toMatchObject({ benches: true, storefront: true, fountain: true, trees: true, lamps: true, sun: true, moon: true })
    const lejos = await page.evaluate(() => {
      const w = window.__world!()!
      const d = w.stats().door!
      w.teleport(d.x, d.z - 12, Math.PI)
      w.advance(1)
      return w.stats().door!.openness
    })
    expect(lejos).toBeLessThan(0.05)
    const cerca = await page.evaluate(() => {
      const w = window.__world!()!
      const d = w.stats().door!
      w.teleport(d.x, d.z - 1.5, Math.PI)
      w.advance(1)
      return w.stats().door!.openness
    })
    expect(cerca).toBeGreaterThan(0.95)
    // y vuelve a cerrarse
    const otraVez = await page.evaluate(() => {
      const w = window.__world!()!
      const d = w.stats().door!
      w.teleport(d.x, d.z - 12, Math.PI)
      w.advance(1)
      return w.stats().door!.openness
    })
    expect(otraVez).toBeLessThan(0.05)
  })

  test('el reloj controla el ciclo solar y las farolas se encienden de noche', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)

    await page.evaluate(() => {
      const world = window.__world!()!
      world.setPaused(true)
      world.setClockOverride('2025-06-21T11:59:00+02:00')
    })
    await expect(page.locator('.world-clock time')).toHaveText('11:59')
    const nextGameMinute = await page.evaluate(() => {
      const world = window.__world!()!
      world.advance(1)
      return world.stats().gameTime
    })
    expect(nextGameMinute).toBe('12:00')

    const day = await page.evaluate(() => {
      const world = window.__world!()!
      world.setClockOverride('2025-06-21T12:00:00+02:00')
      return world.stats()
    })
    expect(day.clock.night).toBe(false)
    expect(day.streetLights.active).toBe(0)

    const night = await page.evaluate(() => {
      const world = window.__world!()!
      world.setClockOverride('2025-06-21T23:00:00+02:00')
      return world.stats()
    })
    expect(night.clock.night).toBe(true)
    expect(night.streetLights.active).toBeGreaterThan(0)
    expect(night.streetLights.intensity).toBeGreaterThanOrEqual(18)
    expect(night.streetLights.intensity).toBeLessThanOrEqual(18)
    expect(night.streetLights.active).toBeGreaterThanOrEqual(24)
    expect(night.streetLights.range).toBeGreaterThanOrEqual(28)
    expect(night.streetLights.decay).toBe(2)
    expect(night.waterAnimated).toBe(true)
    expect(night.clock.moonPhase).toBe('menguante')
  })

  test('delante de la puerta se ofrece entrar; lejos o de lado, no', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const avisos = await page.evaluate(() => {
      const w = window.__world!()!
      const d = w.stats().door!
      const en = (dx: number, dz: number) => {
        w.teleport(d.x + dx, d.z + dz, Math.PI)
        w.advance(0.2)
        return w.stats().prompt
      }
      return { delante: en(0, -0.9), lejos: en(0, -5), aLaDerecha: en(4, -0.9), pegadoAlMuro: en(0, 0.5) }
    })
    expect(avisos.delante).toBe('entrar')
    expect(avisos.lejos).toBeNull()
    expect(avisos.aLaDerecha).toBeNull()
  })

  test('se entra con fundido, la calle desaparece, no se puede salir andando y se sale con la tecla', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    await entrarAlCafe(page)
    const dentro = await stats(page)
    expect(dentro.mode).toBe('interior')
    // la sala está en su propio rincón del mundo, y el fundido ha terminado (no queda la pantalla negra)
    expect(dentro.player.z).toBeGreaterThan(300)
    await expect.poll(() => page.locator('.world-canvas div').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0')

    // empujando contra la puerta y contra las cuatro paredes durante unos segundos, no se sale de la sala
    const limites = await page.evaluate(() => {
      const w = window.__world!()!
      const resultados: { x: number; z: number }[] = []
      for (const [moveX, moveZ] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
        w.orbitCamera(0, 0.3, 3)
        w.inputOverride = { moveX, moveZ, run: true }
        w.advance(4)
        const { x, z } = w.stats().player
        resultados.push({ x, z })
      }
      w.inputOverride = null
      return resultados
    })
    for (const { x, z } of limites) {
      expect(Math.abs(x)).toBeLessThan(4)
      expect(z).toBeGreaterThan(400)
      expect(z).toBeLessThan(407.2)
    }

    // junto a la puerta aparece "salir"
    await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(0, 400.4, Math.PI)
      w.advance(0.2)
    })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'salir', null, { timeout: 30_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().mode === 'calle' && !window.__world!()!.stats().transitioning, null, { timeout: 60_000 })
    const fuera = await stats(page)
    const puerta = fuera.door!
    // queda delante de la puerta, en la calle, y cerca de ella
    expect(Math.hypot(fuera.player.x - puerta.x, fuera.player.z - puerta.z)).toBeLessThan(2)
    expect(fuera.player.z).toBeLessThan(puerta.z)
  })

  test('dentro se pueden usar las sillas y los taburetes, y se llega a ellos por detrás', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    await entrarAlCafe(page)
    // se intenta cruzar un taburete desde la sala; la colisión debe detener al jugador antes de atravesarlo
    const taburete = await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(-0.4, 400 + 3.5, 0)
      w.orbitCamera(Math.PI, 0.1, 4)
      w.inputOverride = { moveX: 0, moveZ: 1, run: true }
      for (let i = 0; i < 24; i++) w.advance(0.05)
      w.inputOverride = null
      const result = w.stats()
      return { ...result, start: { x: result.player.x, z: result.player.z } }
    })
    expect(taburete.player.z).toBeGreaterThan(400 + 4.4)
    expect(taburete.player.z).toBeLessThan(400 + 4.8)
    expect(taburete.prompt).toBe('sentarse')
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    const sentado = await stats(page)
    // sentado en el taburete: unos 0,8 m por delante del punto de acercamiento, sobre su plaza
    expect(Math.hypot(sentado.player.x - -0.4, sentado.player.z - (400 + 5.1))).toBeLessThan(0.4)
    const pelvisY = await page.evaluate(() => window.__world!()!.playerBones(['pelvis']).pelvis[1])
    expect(pelvisY).toBeGreaterThan(0.69)
    expect(pelvisY).toBeLessThan(0.82)
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => !window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'sentarse', null, { timeout: 60_000 })
    const levantadoTaburete = await stats(page)
    expect(Math.hypot(levantadoTaburete.player.x - taburete.start.x, levantadoTaburete.player.z - taburete.start.z)).toBeLessThan(0.1)
    expect(levantadoTaburete.prompt).toBe('sentarse')
    // la silla de la mesa también bloquea la entrada desde atrás, y aun así se puede usar
    const silla = await page.evaluate(() => {
      const w = window.__world!()!
      const seat = { x: -1.05, z: 400 + 1.9, yaw: -Math.PI / 2, approach: { x: -0.25, z: 400 + 1.9 } }
      const forwardX = Math.sin(seat.yaw)
      const forwardZ = Math.cos(seat.yaw)
      w.teleport(seat.approach.x - forwardX * 0.5, seat.approach.z - forwardZ * 0.5, seat.yaw)
      w.orbitCamera(seat.yaw + Math.PI, 0.1, 4)
      w.inputOverride = { moveX: 0, moveZ: 1, run: true }
      for (let i = 0; i < 24; i++) w.advance(0.05)
      w.inputOverride = null
      const stats = w.stats()
      return { stats, seat, start: { x: stats.player.x, z: stats.player.z } }
    })
    const distanciaSilla = Math.hypot(silla.stats.player.x - silla.seat.x, silla.stats.player.z - silla.seat.z)
    expect(distanciaSilla).toBeGreaterThan(0.35)
    expect(distanciaSilla).toBeLessThan(1.1)
    expect(silla.stats.prompt).toBe('sentarse')
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => !window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'sentarse', null, { timeout: 60_000 })
    const levantadoSilla = await stats(page)
    expect(Math.hypot(levantadoSilla.player.x - silla.start.x, levantadoSilla.player.z - silla.start.z)).toBeLessThan(0.1)
    expect(levantadoSilla.prompt).toBe('sentarse')
    const estanteria = await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(3.4, 400 + 6.75, Math.PI / 2)
      w.orbitCamera(Math.PI / 2, 0.1, 4)
      w.inputOverride = { moveX: 0, moveZ: 1, run: true }
      for (let i = 0; i < 24; i++) w.advance(0.05)
      w.inputOverride = null
      return w.stats().player
    })
    expect(estanteria.x).toBeGreaterThan(2.6)
    expect(estanteria.x).toBeLessThan(3.1)
    const lampara = await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(2.0, 400 + 0.6, 0)
      w.orbitCamera(0, 0.1, 4)
      w.inputOverride = { moveX: 1, moveZ: 0, run: true }
      for (let i = 0; i < 24; i++) w.advance(0.05)
      w.inputOverride = null
      return w.stats().player
    })
    expect(lampara.x).toBeGreaterThan(2.5)
    expect(lampara.x).toBeLessThan(2.9)
    // por delante del taburete (donde está la barra) no se puede
    const porDelante = await page.evaluate(() => {
      const w = window.__world!()!
      // delante del taburete izquierdo, fuera de la huella del mostrador
      w.teleport(-3.2, 400 + 5.7, Math.PI)
      w.advance(0.3)
      return w.stats().prompt
    })
    expect(porDelante).not.toBe('sentarse')
  })

  test('entrar y salir varias veces no deja el interior en memoria', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    // La primera entrada inicializa los búferes GPU del modelo del interior antes de medir.
    await entrarAlCafe(page)
    await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(0, 400.4, Math.PI)
      w.advance(0.2)
    })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'salir', null, { timeout: 30_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().mode === 'calle' && !window.__world!()!.stats().transitioning, null, { timeout: 60_000 })
    await page.waitForTimeout(500)
    const antes = await stats(page)
    for (let i = 0; i < 3; i++) {
      await entrarAlCafe(page)
      await page.evaluate(() => {
        const w = window.__world!()!
        w.teleport(0, 400.4, Math.PI)
        w.advance(0.2)
      })
      await page.waitForFunction(() => window.__world!()!.stats().prompt === 'salir', null, { timeout: 30_000 })
      await page.keyboard.press('KeyE')
      await page.waitForFunction(() => window.__world!()!.stats().mode === 'calle' && !window.__world!()!.stats().transitioning, null, { timeout: 60_000 })
    }
    // el renderer cuenta sus recursos al dibujar: se deja pasar un fotograma
    await page.waitForTimeout(500)
    const despues = await stats(page)
    expect(despues.geometries, 'geometrías').toBeLessThanOrEqual(antes.geometries + 2)
    expect(despues.textures, 'texturas').toBeLessThanOrEqual(antes.textures + 2)
  })
})
