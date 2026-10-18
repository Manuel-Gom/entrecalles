import type { Page } from '@playwright/test'
import { expect, test, withCharacters } from './fixtures'

/** Abre el barrio sin vecinos y espera a que el protagonista esté en escena. */
async function entrar(page: Page) {
  await page.addInitScript(() => {
    window.__WORLD_NPC_LIMIT__ = 0
  })
  await page.goto('/#/jugar')
  await page.waitForFunction(() => window.__world?.()?.stats().state === 'listo', null, { timeout: 120_000 })
}

const stats = (page: Page) => page.evaluate(() => window.__world!()!.stats())

/** Un mando inventado: el navegador de pruebas no tiene mandos reales. */
async function instalarMando(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pad: unknown }
    w.__pad = null
    navigator.getGamepads = () => [w.__pad] as unknown as (Gamepad | null)[]
  })
}

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'
const PLAYSTATION = '054c-0ce6-Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'

interface EstadoMando {
  id?: string
  ejes?: number[]
  botones?: Record<number, number>
}

async function ponerMando(page: Page, estado: EstadoMando | null) {
  await page.evaluate((e) => {
    const w = window as unknown as { __pad: unknown }
    if (!e) {
      w.__pad = null
      window.dispatchEvent(new Event('gamepaddisconnected'))
      return
    }
    const botones = Array.from({ length: 17 }, (_, i) => ({ pressed: (e.botones?.[i] ?? 0) > 0.5, value: e.botones?.[i] ?? 0 }))
    const ejes = [0, 0, 0, 0]
    e.ejes?.forEach((v, i) => (ejes[i] = v))
    const antes = w.__pad
    w.__pad = { id: e.id, mapping: 'standard', connected: true, axes: ejes, buttons: botones }
    if (!antes) window.dispatchEvent(new Event('gamepadconnected'))
  }, estado ? { ...estado, id: estado.id ?? XBOX } : null)
}

/** Deja pasar unos fotogramas para que el juego lea el estado actual del mando (el 3D por software va lento). */
const esperarFotogramas = (page: Page, n = 4) =>
  page.evaluate(async (veces) => {
    for (let i = 0; i < veces; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
  }, n)

test.describe('mandos', () => {
  test('un mando Xbox mueve al personaje, corre con el gatillo y se avisa de que está conectado', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await instalarMando(page)
    await entrar(page)
    await expect(page.getByText('Xbox conectado')).toHaveCount(0)

    await ponerMando(page, { ejes: [0, -0.7] })
    await expect(page.getByText('Xbox conectado')).toBeVisible()
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'anda', null, { timeout: 60_000 })
    const medio = await stats(page)
    expect(medio.device).toBe('mando')
    // con la palanca a medias camina más despacio que a tope
    expect(medio.player.speed).toBeLessThan(1.5)
    expect(medio.gamepad).toMatchObject({ kind: 'xbox', standard: true })

    await ponerMando(page, { ejes: [0, -1], botones: { 7: 1 } })
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'corre', null, { timeout: 60_000 })
    await ponerMando(page, { ejes: [0, 0] })
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'quieto', null, { timeout: 60_000 })
  })

  test('la palanca derecha gira la cámara', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await instalarMando(page)
    await entrar(page)
    const antes = (await stats(page)).cameraYaw
    await ponerMando(page, { ejes: [0, 0, 1, 0] })
    await page.waitForFunction((y) => Math.abs(window.__world!()!.stats().cameraYaw - y) > 0.3, antes, { timeout: 60_000 })
    await ponerMando(page, { ejes: [0, 0, 0, 0] })
  })

  test('el botón de menú pausa y reanuda; la ayuda cambia a los nombres del mando', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await instalarMando(page)
    await entrar(page)
    await ponerMando(page, { id: PLAYSTATION, botones: { 9: 1 } })
    await expect(page.getByRole('dialog', { name: 'Pausa' })).toBeVisible()
    await expect(page.getByText('PlayStation conectado')).toBeVisible()
    await esperarFotogramas(page)
    await ponerMando(page, { id: PLAYSTATION, botones: {} })
    await esperarFotogramas(page)
    await ponerMando(page, { id: PLAYSTATION, botones: { 9: 1 } })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await ponerMando(page, { id: PLAYSTATION, botones: {} })
    await expect(page.locator('.world-help')).toContainText('R2 correr')
  })

  test('desconectar el mando devuelve el control al teclado, y se puede reconectar', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await instalarMando(page)
    await entrar(page)
    await ponerMando(page, { ejes: [0, 0.8] })
    await page.waitForFunction(() => window.__world!()!.stats().device === 'mando', null, { timeout: 60_000 })
    await ponerMando(page, null)
    await expect(page.getByText('Xbox conectado')).toHaveCount(0)
    await page.waitForFunction(() => window.__world!()!.stats().device === 'teclado', null, { timeout: 60_000 })
    await page.keyboard.down('KeyW')
    await page.waitForFunction(() => window.__world!()!.stats().player.animation === 'anda', null, { timeout: 60_000 })
    await page.keyboard.up('KeyW')
    await ponerMando(page, { ejes: [0, 0] })
    await expect(page.getByText('Xbox conectado')).toBeVisible()
  })

  test('un mando sin mapeo estándar avisa de que puede fallar', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await instalarMando(page)
    await entrar(page)
    await page.evaluate(() => {
      const w = window as unknown as { __pad: unknown }
      w.__pad = { id: 'Mando raro', mapping: '', connected: true, axes: [0, 0, 0, 0], buttons: [] }
      window.dispatchEvent(new Event('gamepadconnected'))
    })
    await expect(page.getByText(/no usa el mapeo estándar/)).toBeVisible()
  })
})

test.describe('diagnóstico y bancos', () => {
  test('el contador de FPS abre un diagnóstico con lo necesario para comparar mediciones', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    await page.getByRole('button', { name: /FPS/ }).click()
    const panel = page.getByRole('region', { name: 'Diagnóstico de rendimiento' })
    await expect(panel).toBeVisible()
    await page.waitForFunction(() => /FPS medios: \d+/.test(window.__world!()!.diagnosticsText()), null, { timeout: 60_000 })
    for (const texto of ['FPS medios', 'Tirones', 'Calidad: media', 'Resolución', 'Dispositivo de entrada: teclado y ratón', 'Tarjeta gráfica']) {
      await expect(panel).toContainText(texto)
    }
    await page.keyboard.press('F3')
    await expect(panel).toHaveCount(0)
  })

  test('el protagonista se sienta en un banco del parque y se levanta', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const banco = await page.evaluate(() => {
      const w = window.__world!()!
      const b = w.layout.benches.find((x) => Math.abs(x.x) < 10 && Math.abs(x.z) < 10)!
      // delante del banco (por donde se sienta uno), mirando hacia él
      w.teleport(b.x + Math.sin(b.yaw) * 1.4, b.z + Math.cos(b.yaw) * 1.4, b.yaw + Math.PI)
      return b
    })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'sentarse', null, { timeout: 30_000 })
    await expect(page.getByText(/Pulsa\s*E\s*para sentarte/)).toBeVisible()

    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    const sentado = await stats(page)
    expect(Math.hypot(sentado.player.x - banco.x, sentado.player.z - banco.z)).toBeLessThan(0.5)
    await expect(page.getByText(/Pulsa\s*E\s*para levantarte/)).toBeVisible()

    // al pulsar de nuevo se levanta y vuelve a poder sentarse
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => !window.__world!()!.stats().player.seated && window.__world!()!.stats().prompt === 'sentarse', null, { timeout: 60_000 })
  })

  test('sin banco cerca no hay aviso, y por detrás del banco tampoco', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    expect((await stats(page)).prompt).toBeNull()
    await page.evaluate(() => {
      const w = window.__world!()!
      const b = w.layout.benches.find((x) => Math.abs(x.x) < 10 && Math.abs(x.z) < 10)!
      w.teleport(b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, b.yaw)
      w.advance(0.2)
    })
    expect((await stats(page)).prompt).toBeNull()
  })
})
