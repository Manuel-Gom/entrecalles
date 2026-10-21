import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { emptySave, expect, settings, test, withCharacters } from './fixtures'

/** Abre el barrio y espera a que el protagonista esté en escena. */
async function entrar(page: Page, { pnj = 0 }: { pnj?: number } = {}) {
  // el 3D por software es lento: se limita cuántos PNJ se cargan
  await page.addInitScript((limite) => {
    window.__WORLD_NPC_LIMIT__ = limite
  }, pnj)
  await page.goto('/#/jugar')
  await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120_000 })
}

const stats = (page: Page) => page.evaluate(() => window.__world!()!.stats())

test.describe('el barrio', () => {
  test('al elegir "Comenzar aventura" se entra en el barrio con el protagonista', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await page.addInitScript(() => {
      window.__WORLD_NPC_LIMIT__ = 0
    })
    await page.goto('/#/resumen')
    await page.getByRole('button', { name: /Comenzar aventura/ }).click()
    await expect(page).toHaveURL(/#\/jugar$/)
    await expect(page.getByRole('heading', { name: 'Explorando el barrio con Marcos' })).toBeAttached()
    await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120_000 })
    await expect(page.getByRole('application')).toBeVisible()
    expect((await stats(page)).player).toMatchObject({ animation: 'quieto' })
    // el barrio ocupa toda la pantalla: sin la barra del menú
    await expect(page.locator('.topbar')).toHaveCount(0)
  })

  test('sin personaje elegido se vuelve a la biblioteca', async ({ page, sembrar }) => {
    await sembrar(emptySave)
    await page.goto('/#/jugar')
    await expect(page).toHaveURL(/#\/personajes$/)
    await expect(page.getByText('Elige o crea un personaje para salir a la calle.')).toBeVisible()
  })

  test('con W el personaje anda y con Mayús corre, más deprisa', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const inicio = await stats(page)

    await page.keyboard.down('KeyW')
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'anda', null, { timeout: 60_000 })
    const andando = await stats(page)
    expect(andando.player.speed).toBeGreaterThan(0.5)
    expect(andando.player.speed).toBeLessThan(1.7)
    await page.waitForFunction((z) => Math.abs(window.__world!()!.stats().player.z - z) > 1, inicio.player.z, { timeout: 60_000 })

    await page.keyboard.down('Shift')
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'corre', null, { timeout: 60_000 })
    expect((await stats(page)).player.speed).toBeGreaterThan(3)

    await page.keyboard.up('Shift')
    await page.keyboard.up('KeyW')
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'quieto', null, { timeout: 60_000 })
  })

  test('con la distribución de flechas se mueve con las flechas y no con WASD', async ({ page, sembrar }) => {
    await sembrar({ ...withCharacters, settings: { ...settings, controlPreset: 'flechas' } })
    await entrar(page)
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(1500)
    await page.keyboard.up('KeyW')
    expect((await stats(page)).player.animation).toBe('quieto')
    await page.keyboard.down('ArrowUp')
    await page.waitForFunction(() => window.__world!()!.stats().player.animation !== 'quieto', null, { timeout: 60_000 })
    await page.keyboard.up('ArrowUp')
  })

  test('no se pueden atravesar los edificios ni salir del mundo', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const resultado = await page.evaluate(() => {
      const world = window.__world!()!
      const fuera: string[] = []
      const dentro = (x: number, z: number) => world.layout.obstacles.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)
      // contra cada uno de los 32 edificios, desde sus cuatro lados, empujando en línea recta durante 6 s
      for (const { box } of world.layout.buildings) {
        const lados: [number, number, number, number][] = [
          // [x inicial, z inicial, moveX, moveZ] con la cámara a yaw 0: moveZ = 1 va hacia -z
          [(box.minX + box.maxX) / 2, box.maxZ + 3, 0, 1], // desde el sur hacia el norte
          [(box.minX + box.maxX) / 2, box.minZ - 3, 0, -1], // desde el norte hacia el sur
          [box.maxX + 3, (box.minZ + box.maxZ) / 2, -1, 0], // desde el este hacia el oeste
          [box.minX - 3, (box.minZ + box.maxZ) / 2, 1, 0], // desde el oeste hacia el este
        ]
        for (const [x, z, moveX, moveZ] of lados) {
          // los solares de una manzana están pegados: si ese lado da a otro edificio, no hay por dónde acercarse
          if (world.layout.obstacles.some((b) => x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4)) continue
          world.orbitCamera(0, 0.3, 4)
          world.teleport(x, z)
          world.inputOverride = { moveX, moveZ, run: true }
          world.advance(3)
          const { x: px, z: pz } = world.stats().player
          if (dentro(px, pz)) fuera.push(`dentro de un obstáculo en (${px.toFixed(2)}, ${pz.toFixed(2)})`)
        }
      }
      // hacia cada borde del mundo
      for (const [moveX, moveZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        world.teleport(0, 20)
        world.inputOverride = { moveX, moveZ, run: true }
        world.advance(40)
        const { x, z } = world.stats().player
        if (Math.abs(x) > 66 || Math.abs(z) > 66) fuera.push(`fuera del mundo en (${x.toFixed(1)}, ${z.toFixed(1)})`)
      }
      world.inputOverride = null
      return fuera
    })
    expect(resultado).toEqual([])
  })

  test('los PNJ salen a la calle: unos se sientan en los bancos y otros hacen footing', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page, { pnj: 4 }) // los tres primeros del reparto se sientan y el cuarto corre
    await page.waitForFunction(() => { const n = window.__world!()!.stats().npcs; return n.total === 4 && n.loaded === 4 }, null, { timeout: 150_000 })

    const resultado = await page.evaluate(() => {
      const world = window.__world!()!
      world.teleport(0, 20)
      let sentadosAlaVez = 0
      let corrieron = false
      const sentados = new Set<string>()
      for (let s = 0; s < 400; s++) {
        world.advance(1)
        const { list } = world.stats().npcs
        sentadosAlaVez = Math.max(sentadosAlaVez, list.filter((n) => n.sit > 0.99).length)
        for (const n of list) {
          if (n.sit > 0.99) sentados.add(n.id)
          if (n.activity === 'correr' && n.speed > 3) corrieron = true
        }
      }
      return { sentadosAlaVez, corrieron, quienesSeSentaron: sentados.size }
    })
    expect(resultado.sentadosAlaVez).toBeGreaterThanOrEqual(1)
    expect(resultado.quienesSeSentaron).toBeGreaterThanOrEqual(2)
    expect(resultado.corrieron).toBe(true)
  })

  test('Escape pausa el juego y Continuar lo reanuda', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    await expect(page.getByRole('heading', { name: 'Explorando el barrio con Marcos' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Pausa' })).toBeVisible()
    const continuar = page.getByRole('button', { name: 'Continuar' })
    const volver = page.getByRole('link', { name: 'Volver al menú' })
    await expect(continuar).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(volver).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(continuar).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(volver).toBeFocused()
    const t0 = (await stats(page)).time
    await page.waitForTimeout(800)
    expect((await stats(page)).time, 'el tiempo de juego se detiene en pausa').toBe(t0)
    await continuar.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForFunction((t) => window.__world!()!.stats().time > t, t0, { timeout: 30_000 })
  })

  test('un catálogo que falla se explica y se puede reintentar', async ({ page, sembrar, ignorarConsola }) => {
    ignorarConsola(/Failed to load resource|ERR_FAILED/)
    await sembrar(withCharacters)
    let requests = 0
    await page.route('**/models/modular/manifest.json', (route) => {
      requests += 1
      if (requests === 1) return route.abort()
      return route.continue()
    })
    await page.goto('/#/jugar')
    await expect(page.getByText('No se pudo cargar el catálogo de personajes.')).toBeVisible()
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120_000 })
  })

  test('la calidad se cambia desde la interfaz y se recuerda', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    expect((await stats(page)).quality).toBe('media')
    await page.getByLabel('Calidad').selectOption('baja')
    expect((await stats(page)).quality).toBe('baja')
    await page.reload()
    await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120_000 })
    expect((await stats(page)).quality).toBe('baja')
  })

  test('tras usar un control con el ratón el teclado vuelve al barrio; con el teclado el foco se queda', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const lienzo = page.locator('.world-view canvas')
    const calidad = page.getByLabel('Calidad')
    const pausa = page.getByRole('button', { name: 'Pausa', exact: true })

    // ratón: elegir la calidad, y pausar y reanudar con clics
    await calidad.click()
    await calidad.selectOption('baja')
    await expect(lienzo).toBeFocused()
    await pausa.click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(lienzo).toBeFocused()

    // teclado: el foco sigue en el selector y vuelve al botón que abrió la pausa
    await calidad.focus()
    await page.keyboard.press('ArrowDown')
    await expect(calidad).toBeFocused()
    await pausa.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pausa).toBeFocused()
  })

  test('entrar y salir varias veces no deja el barrio ni su contexto 3D en memoria', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await page.addInitScript(() => {
      window.__WORLD_NPC_LIMIT__ = 0
    })
    for (let i = 0; i < 3; i++) {
      await page.goto('/#/jugar')
      await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120_000 })
      await page.getByRole('link', { name: 'Entrecalles, inicio' }).click()
      await expect(page).toHaveURL(/#\/$/)
      await expect.poll(() => page.evaluate(() => window.__world?.() ?? null)).toBeNull()
      await expect(page.locator('.world')).toHaveCount(0)
    }
  })

  test('el barrio cumple WCAG 2.1 AA', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(axe.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([])
  })
})
