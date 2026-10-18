import type { Page } from '@playwright/test'
import { expect, test, withCharacters } from './fixtures'

/** Abre el barrio sin vecinos y espera a que estén el protagonista y los modelos de Blender (bancos y fachada). */
async function entrar(page: Page) {
  await page.addInitScript(() => {
    window.__WORLD_NPC_LIMIT__ = 0
  })
  await page.goto('/#/jugar')
  await page.waitForFunction(
    () => {
      const s = window.__world?.()?.stats()
      return Boolean(s && s.state === 'listo' && s.scenery.benches && s.scenery.storefront)
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
  test('los bancos y la fachada se cargan de Blender y la puerta se abre al acercarse', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
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
    // delante de un taburete del mostrador (se llega por detrás: desde la sala), el aviso es "sentarte"
    const taburete = await page.evaluate(() => {
      const w = window.__world!()!
      // el mostrador está al fondo (z ≈ 400 + 5,9); los taburetes, algo antes, mirando hacia él
      w.teleport(-0.4, 400 + 4.5, 0)
      w.advance(0.3)
      return w.stats().prompt
    })
    expect(taburete).toBe('sentarse')
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    const sentado = await stats(page)
    // sentado en el taburete: unos 0,8 m por delante del punto de acercamiento, sobre su plaza
    expect(Math.hypot(sentado.player.x - -0.4, sentado.player.z - (400 + 5.3))).toBeLessThan(0.4)
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => !window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    // por delante del taburete (donde está la barra) no se puede
    const porDelante = await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(-0.4, 400 + 5.9 - 0.2, Math.PI)
      w.advance(0.3)
      return w.stats().prompt
    })
    expect(porDelante).not.toBe('sentarse')
  })

  test('entrar y salir varias veces no deja el interior en memoria', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
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
