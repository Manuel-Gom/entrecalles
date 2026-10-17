import { expect, test as base, type Page } from '@playwright/test'

export const settings = {
  masterVolume: 80, musicVolume: 65, effectsVolume: 80, controlPreset: 'clasico',
  subtitles: true, highContrast: false, reducedMotion: false, largeText: false,
}

export type SaveSeed = {
  version: 2
  characters: { id: string; name: string; spec: Record<string, unknown>; thumb?: string }[]
  activeId: string | null
  difficulty: string
  settings: typeof settings
}

export const withCharacters: SaveSeed = {
  version: 2,
  characters: [
    { id: 'a', name: 'Marcos', spec: { cuerpo: 'marcos' } },
    { id: 'b', name: 'Dani', spec: { cuerpo: 'dani' } },
    { id: 'c', name: 'Ramón', spec: { cuerpo: 'ramon' } },
  ],
  activeId: 'a',
  difficulty: 'equilibrada',
  settings,
}
export const emptySave: SaveSeed = { version: 2, characters: [], activeId: null, difficulty: 'equilibrada', settings }

/** Controla el visor 3D desde la prueba. */
export class Visor {
  constructor(private readonly page: Page) {}

  stats() {
    return this.page.evaluate(() => window.__avatarStudio!().stats())
  }

  /** Espera a que el visor esté listo (y, si se indica, mostrando ese cuerpo). */
  async listo(modelo?: string) {
    await this.page.waitForFunction(
      (model) => {
        const stats = window.__avatarStudio?.().stats()
        return Boolean(stats && stats.state === 'ready' && (!model || stats.model === model))
      },
      modelo,
      { timeout: 90_000 },
    )
  }

  /** Ejecuta una acción de la interfaz y espera a que cambie el cuerpo o las piezas mostradas. */
  async tras(accion: () => Promise<unknown>) {
    const antes = await this.stats().then((s) => `${s.model}|${s.pieces}`)
    await accion()
    await this.page.waitForFunction(
      (before) => {
        const s = window.__avatarStudio?.().stats()
        return Boolean(s && s.state === 'ready' && `${s.model}|${s.pieces}` !== before)
      },
      antes,
      { timeout: 60_000 },
    )
    return this.stats()
  }
}

type Fixtures = {
  /** Guarda en localStorage el estado inicial (solo la primera vez que se abre la pestaña: recargar no lo pisa). */
  sembrar: (save: SaveSeed | Record<string, unknown> | null) => Promise<void>
  visor: Visor
  /** Mensajes de consola que se aceptan en esta prueba. */
  ignorarConsola: (patron: RegExp) => void
}

export const test = base.extend<Fixtures>({
  sembrar: async ({ page }, use) => {
    await use(async (save) => {
      await page.addInitScript((value) => {
        if (value && !sessionStorage.getItem('sembrado')) {
          localStorage.setItem('entrecalles-save-v2', JSON.stringify(value))
          sessionStorage.setItem('sembrado', '1')
        }
      }, save)
    })
  },
  visor: async ({ page }, use) => {
    await use(new Visor(page))
  },
  ignorarConsola: [async ({ page }, use) => {
    const ignorados: RegExp[] = []
    const errores: string[] = []
    // las fuentes de Google no se usan (están en local) y pueden tardar: se responden vacías
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) errores.push(`${message.type()}: ${message.text()}`)
    })
    page.on('pageerror', (error) => errores.push(`pageerror: ${error.message}`))
    await use((patron) => void ignorados.push(patron))
    const reales = errores.filter((mensaje) => !ignorados.some((patron) => patron.test(mensaje)))
    expect(reales, 'errores o avisos de consola').toEqual([])
  }, { auto: true }], // la consola se vigila en todas las pruebas
})

export { expect }
