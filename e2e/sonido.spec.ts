import type { Page } from '@playwright/test'
import { expect, settings, test, withCharacters } from './fixtures'

/** Abre el barrio con `pnj` vecinos y espera a que estén cargados. */
async function entrar(page: Page, pnj = 0) {
  await page.addInitScript((limite) => {
    window.__WORLD_NPC_LIMIT__ = limite
  }, pnj)
  await page.goto('/#/jugar')
  await page.waitForFunction(
    (esperados) => {
      const s = window.__world?.()?.stats()
      return Boolean(s && s.state === 'listo' && s.scenery.storefront && s.npcs.loaded === esperados)
    },
    pnj,
    { timeout: 240_000 },
  )
}

const stats = (page: Page) => page.evaluate(() => window.__world!()!.stats())

test.describe('sonido', () => {
  test('cada paso suena: andando y corriendo, con el suelo que se pisa', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    const resultado = await page.evaluate(() => {
      const w = window.__world!()!
      const pasos = () => w.stats().audio.steps
      const mover = (x: number, z: number, run: boolean, segundos: number) => {
        w.orbitCamera(0, 0.3, 4)
        w.teleport(x, z, 0)
        w.advance(0.5) // se asienta
        const antes = pasos()
        w.inputOverride = { moveX: 1, moveZ: 0, run }
        w.advance(segundos)
        w.inputOverride = null
        return { pasos: pasos() - antes, suelo: w.stats().audio.lastSurface }
      }
      return {
        andando: mover(-10, 16.7, false, 6), // acera
        corriendo: mover(-10, 16.7, true, 3),
        hierba: mover(-10, 8, false, 3), // el parque
        calzada: mover(-9, 20, false, 3), // la calle entre manzanas
        parado: (() => {
          w.advance(1) // termina de frenar
          const antes = pasos()
          w.advance(3)
          return pasos() - antes
        })(),
      }
    })
    // andando: unos 115 pasos por minuto → ~11 en 6 s; corriendo: unos 185 → ~9 en 3 s
    expect(resultado.andando.pasos).toBeGreaterThanOrEqual(8)
    expect(resultado.andando.pasos).toBeLessThanOrEqual(15)
    expect(resultado.andando.suelo).toBe('acera')
    expect(resultado.corriendo.pasos).toBeGreaterThanOrEqual(6)
    expect(resultado.corriendo.pasos).toBeLessThanOrEqual(12)
    expect(resultado.hierba.suelo).toBe('hierba')
    expect(resultado.calzada.suelo).toBe('calzada')
    // parado no hay pasos
    expect(resultado.parado).toBe(0)
  })

  test('el sonido espera a un gesto del usuario, se activa con una tecla y se suspende en pausa', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    await page.keyboard.press('KeyW') // un gesto
    await page.keyboard.up('KeyW')
    await page.waitForFunction(() => window.__world!()!.stats().audio.state === 'running', null, { timeout: 30_000 })
    await expect(page.getByText(/activar el sonido/)).toHaveCount(0)

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.__world!()!.stats().audio.state === 'suspended', null, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.waitForFunction(() => window.__world!()!.stats().audio.state === 'running', null, { timeout: 30_000 })
  })

  test('dentro del café cambia el ambiente y el suelo, y las puertas suenan', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    expect((await stats(page)).audio.environment).toBe('calle')
    const eventosAntes = (await stats(page)).audio.events
    await page.evaluate(() => {
      const w = window.__world!()!
      const d = w.stats().door!
      w.teleport(d.x, d.z - 0.9, Math.PI)
    })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'entrar', null, { timeout: 30_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().mode === 'interior' && !window.__world!()!.stats().transitioning, null, { timeout: 90_000 })
    const dentro = await page.evaluate(() => {
      const w = window.__world!()!
      w.orbitCamera(0, 0.3, 3)
      w.inputOverride = { moveX: 0, moveZ: -1, run: false } // hacia dentro de la sala
      w.advance(3)
      w.inputOverride = null
      return w.stats().audio
    })
    expect(dentro.environment).toBe('interior')
    expect(dentro.lastSurface).toBe('baldosa')
    expect(dentro.events).toBeGreaterThan(eventosAntes)
    expect(dentro.lastEvent).toBe('puerta')

    await page.evaluate(() => {
      const w = window.__world!()!
      w.teleport(0, 400.4, Math.PI)
      w.advance(0.2)
    })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'salir', null, { timeout: 30_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().mode === 'calle' && !window.__world!()!.stats().transitioning, null, { timeout: 60_000 })
    expect((await stats(page)).audio.environment).toBe('calle')
  })

  test('sentarse y levantarse suenan', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await entrar(page)
    await page.evaluate(() => {
      const w = window.__world!()!
      const b = w.layout.benches.find((x) => Math.abs(x.x) < 10 && Math.abs(x.z) < 10)!
      w.teleport(b.x + Math.sin(b.yaw) * 1.4, b.z + Math.cos(b.yaw) * 1.4, b.yaw + Math.PI)
    })
    await page.waitForFunction(() => window.__world!()!.stats().prompt === 'sentarse', null, { timeout: 30_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().player.seated, null, { timeout: 60_000 })
    expect((await stats(page)).audio.lastEvent).toBe('sentarse')
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__world!()!.stats().audio.lastEvent === 'levantarse', null, { timeout: 60_000 })
  })
})

/** Con 9 vecinos están los tres que se sientan, los dos que corren y las dos parejas que charlan. */
test.describe('charlas con subtítulos', () => {
  async function irAUnaCharla(page: Page) {
    await entrar(page, 9)
    // se deja pasar el tiempo hasta que una pareja esté hablando, y se pone al protagonista a su lado
    for (let i = 0; i < 80; i++) {
      const hablando = await page.evaluate(() => {
        const w = window.__world!()!
        w.advance(5)
        const s = w.stats()
        const chat = s.chats.find((c) => c.talking)
        if (!chat) return null
        const npc = s.npcs.list.find((n) => n.name === chat.members[0])
        return npc ? { x: npc.x, z: npc.z } : null
      })
      if (hablando) {
        await page.evaluate((p) => window.__world!()!.teleport(p.x + 1.5, p.z, 0), hablando)
        return
      }
    }
    throw new Error('ninguna pareja llegó a charlar')
  }

  test('quien está cerca lee lo que dicen, línea a línea y con el nombre de quien habla', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await irAUnaCharla(page)
    const lineas = await page.evaluate(() => {
      const w = window.__world!()!
      const vistas: { speaker: string; text: string }[] = []
      for (let s = 0; s < 40; s++) {
        w.advance(1)
        const sub = w.stats().subtitle
        if (sub && !vistas.some((v) => v.text === sub.text)) vistas.push(sub)
      }
      return vistas
    })
    expect(lineas.length).toBeGreaterThanOrEqual(3)
    expect(new Set(lineas.map((l) => l.speaker)).size, 'hablan los dos').toBe(2)
    for (const { speaker, text } of lineas) {
      expect(speaker.length).toBeGreaterThan(1)
      expect(text.length).toBeGreaterThan(8)
    }
  })

  test('el subtítulo se ve en pantalla con el nombre y el texto', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await irAUnaCharla(page)
    await page.waitForFunction(() => window.__world!()!.stats().subtitle !== null, null, { timeout: 60_000 }).catch(async () => {
      await page.evaluate(() => window.__world!()!.advance(8))
    })
    const sub = await stats(page)
    expect(sub.subtitle).not.toBeNull()
    await expect(page.locator('.world-subtitle')).toContainText(sub.subtitle!.speaker)
  })

  test('con los subtítulos desactivados no se muestra texto, pero la charla sigue', async ({ page, sembrar }) => {
    await sembrar({ ...withCharacters, settings: { ...settings, subtitles: false } })
    await irAUnaCharla(page)
    const resultado = await page.evaluate(() => {
      const w = window.__world!()!
      let texto = 0
      for (let s = 0; s < 20; s++) {
        w.advance(1)
        if (w.stats().subtitle) texto++
      }
      return { texto, charlando: w.stats().chats.some((c) => c.talking || c.conversations > 0) }
    })
    expect(resultado.texto).toBe(0)
    expect(resultado.charlando).toBe(true)
    await expect(page.locator('.world-subtitle')).toHaveCount(0)
  })

  test('lejos de la charla no se lee nada', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await irAUnaCharla(page)
    const lejos = await page.evaluate(() => {
      const w = window.__world!()!
      const s = w.stats()
      const chat = s.chats.find((c) => c.talking)!
      const npc = s.npcs.list.find((n) => n.name === chat.members[0])!
      // al otro lado del barrio
      w.teleport(npc.x > 0 ? -50 : 50, npc.z > 0 ? -50 : 50, 0)
      w.advance(0.3)
      return w.stats().subtitle
    })
    expect(lejos).toBeNull()
  })
})
