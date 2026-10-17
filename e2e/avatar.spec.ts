import { expect, test, withCharacters } from './fixtures'
import type { Page } from '@playwright/test'

type Cuerpo = { id: string; genero?: string; colorPelo?: string; defecto: Record<string, string> }
type Catalogo = { cuerpos: Cuerpo[]; piezas: { id: string; slot: string; tinte?: boolean; colorDefecto?: string; para?: string[] }[] }

const specDe = (cuerpo: Cuerpo) => ({ ...cuerpo.defecto, cuerpo: cuerpo.id, colorPelo: cuerpo.colorPelo ?? null })
const cargarCatalogo = (page: Page) => page.evaluate(() => fetch('/models/modular/manifest.json').then((r) => r.json())) as Promise<Catalogo>
const mostrar = (page: Page, spec: Record<string, unknown>, catalogo: Catalogo) =>
  page.evaluate(([valor, datos]) => window.__avatarStudio!().setAvatar(valor as Record<string, unknown>, datos), [spec, catalogo] as const)
const stats = (page: Page) => page.evaluate(() => window.__avatarStudio!().stats())
const listo = (page: Page, cuerpo: string) =>
  page.waitForFunction((id) => { const s = window.__avatarStudio!().stats(); return s.state === 'ready' && s.model === id }, cuerpo, { timeout: 90_000 })
const retrasar = (page: Page, cuerpo: string, ms: number) =>
  page.route(`**/models/modular/${cuerpo}/**`, async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.fulfill({ response })
  })

async function abrir(page: Page, sembrar: (s: never) => Promise<void>) {
  await sembrar({ ...withCharacters, characters: [], activeId: null, settings: { ...withCharacters.settings, reducedMotion: true } } as never)
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__avatarStudio === 'function')
  await page.waitForFunction(() => window.__avatarStudio!().stats().state === 'ready', null, { timeout: 90_000 })
  return cargarCatalogo(page)
}

test.describe('cambio de personaje', () => {
  test('el avatar anterior sigue vestido hasta que el siguiente está completo', async ({ page, sembrar }) => {
    const catalogo = await abrir(page, sembrar)
    const primero = catalogo.cuerpos.find((c) => c.id === 'marcos')!
    const segundo = catalogo.cuerpos.find((c) => c.id === 'dani')!

    await mostrar(page, specDe(primero), catalogo)
    await listo(page, primero.id)
    const antes = await stats(page)
    expect(antes.pieces.split(',').some((id) => id !== '-')).toBe(true)

    await retrasar(page, segundo.id, 700)
    const cambio = mostrar(page, specDe(segundo), catalogo)
    await page.waitForFunction(() => window.__avatarStudio!().stats().state === 'loading')
    await page.waitForTimeout(120)
    const durante = await stats(page)
    expect(durante.model, 'el modelo anterior debe seguir visible durante la carga').toBe(primero.id)
    expect(durante.pieces, 'la ropa anterior debe seguir montada').toBe(antes.pieces)
    await cambio
    await listo(page, segundo.id)
    const despues = (await stats(page)).pieces.split(',')
    expect(despues).toContain(segundo.defecto.calzado)
    expect(despues).toContain(segundo.defecto.conjunto)
  })

  test('los cambios rápidos descartan los intermedios y terminan con el último', async ({ page, sembrar }) => {
    const catalogo = await abrir(page, sembrar)
    const a = catalogo.cuerpos.find((c) => c.id === 'lucia')!
    const b = catalogo.cuerpos.find((c) => c.id === 'hiro')!
    await retrasar(page, a.id, 700)
    await retrasar(page, b.id, 120)
    const primera = mostrar(page, specDe(a), catalogo)
    await page.waitForTimeout(80)
    const ultima = mostrar(page, specDe(b), catalogo)
    await Promise.all([primera, ultima])
    await listo(page, b.id)
    const piezas = (await stats(page)).pieces.split(',')
    expect(piezas).toContain(b.defecto.calzado)
    expect((await stats(page)).model).toBe(b.id)
  })

  test('si falla la carga se conserva el avatar anterior y se avisa del error', async ({ page, sembrar, ignorarConsola }) => {
    ignorarConsola(/Failed to load resource|ERR_FAILED|No se pudo preparar el personaje completo/)
    const catalogo = await abrir(page, sembrar)
    const actual = catalogo.cuerpos.find((c) => c.id === 'marcos')!
    await mostrar(page, specDe(actual), catalogo)
    await listo(page, actual.id)
    const previo = await stats(page)

    const roto = catalogo.cuerpos.find((c) => c.id === 'kenji')!
    await page.route(`**/models/modular/${roto.id}/calzado/${roto.defecto.calzado}.glb`, (route) => route.abort())
    await mostrar(page, specDe(roto), catalogo)
    const tras = await stats(page)
    expect(tras.state).toBe('error')
    expect(tras.model).toBe(previo.model)
    expect(tras.pieces).toBe(previo.pieces)
    await expect(page.locator('.preview-error').filter({ hasText: 'No se pudo cargar el personaje.' })).toBeVisible()
  })

  test('tras 40 cambios de piezas la memoria de la tarjeta gráfica no crece', async ({ page, sembrar }) => {
    const catalogo = await abrir(page, sembrar)
    const cuerpo = catalogo.cuerpos.find((c) => c.id === 'marcos')!
    const pelos = catalogo.piezas.filter((p) => p.slot === 'pelo' && (p.para ?? ['hombre', 'mujer']).includes('hombre')).slice(0, 4).map((p) => p.id)
    const calzados = catalogo.piezas.filter((p) => p.slot === 'calzado' && (p.para ?? ['hombre', 'mujer']).includes('hombre')).slice(0, 4).map((p) => p.id)
    await mostrar(page, specDe(cuerpo), catalogo)
    await listo(page, cuerpo.id)
    const antes = await stats(page)
    for (let i = 0; i < 40; i += 1) {
      await mostrar(page, { ...specDe(cuerpo), pelo: pelos[i % pelos.length], calzado: calzados[(i >> 1) % calzados.length] }, catalogo)
    }
    await listo(page, cuerpo.id)
    const despues = await stats(page)
    expect(despues.textures, 'texturas').toBeLessThanOrEqual(antes.textures + 8)
    expect(despues.geometries, 'geometrías').toBeLessThanOrEqual(antes.geometries + 4)
  })
})

test.describe('teñido y piezas del rostro', () => {
  test('las telas teñibles usan su color original o el elegido', async ({ page, sembrar }) => {
    const catalogo = await abrir(page, sembrar)
    const prenda = catalogo.piezas.find((p) => p.slot === 'torso' && p.tinte && p.colorDefecto && (p.para ?? ['hombre']).includes('hombre'))!
    const cuerpo = catalogo.cuerpos.find((c) => c.id === 'marcos')!
    const base = { ...specDe(cuerpo), conjunto: null, torso: prenda.id }

    await mostrar(page, base, catalogo)
    await listo(page, cuerpo.id)
    expect((await stats(page)).tints.torso, 'color original de la prenda').toBe(prenda.colorDefecto!.toLowerCase())

    await mostrar(page, { ...base, colores: { torso: '#3f7fbf' } }, catalogo)
    expect((await stats(page)).tints.torso).toBe('#3f7fbf')

    await mostrar(page, { ...base, torso: 'namuhekam_male_polo_shirt' }, catalogo)
    expect((await stats(page)).tints.torso, 'un polo sin color elegido se ve como es').toBeUndefined()
  })

  test('los vestidos teñibles también se tiñen y los zapatos no', async ({ page, sembrar }) => {
    const catalogo = await abrir(page, sembrar)
    const vestido = catalogo.piezas.find((p) => p.slot === 'conjunto' && p.tinte && p.colorDefecto)!
    const cuerpo = catalogo.cuerpos.find((c) => c.genero === 'mujer')!
    await mostrar(page, { ...specDe(cuerpo), conjunto: vestido.id, torso: null, piernas: null }, catalogo)
    await listo(page, cuerpo.id)
    let tintes = (await stats(page)).tints
    expect(tintes.conjunto).toBe(vestido.colorDefecto!.toLowerCase())
    expect(tintes.calzado, 'el calzado no se tiñe').toBeUndefined()

    await mostrar(page, { ...specDe(cuerpo), conjunto: vestido.id, torso: null, piernas: null, colores: { conjunto: '#2f9e9e' } }, catalogo)
    tintes = (await stats(page)).tints
    expect(tintes.conjunto).toBe('#2f9e9e')
  })

  test('la barba lleva el color del pelo y las gafas y barbas se muestran', async ({ page, sembrar }) => {
    const catalogo = await abrir(page, sembrar)
    const barba = catalogo.piezas.find((p) => p.slot === 'barba')!
    const gafas = catalogo.piezas.find((p) => p.slot === 'gafas')!
    const cuerpo = catalogo.cuerpos.find((c) => c.id === 'marcos')!
    await mostrar(page, { ...specDe(cuerpo), barba: barba.id, gafas: gafas.id, colorPelo: '#9a9a9a' }, catalogo)
    await listo(page, cuerpo.id)
    const datos = await stats(page)
    const piezas = datos.pieces.split(',')
    expect(piezas).toContain(barba.id)
    expect(piezas).toContain(gafas.id)
    expect(datos.tints.barba).toBe('#9a9a9a')
    expect(datos.tints.pelo).toBe('#9a9a9a')

    await mostrar(page, { ...specDe(cuerpo), barba: barba.id, colorPelo: null }, catalogo)
    expect((await stats(page)).tints.barba, 'sin color elegido se ve el original').toBeUndefined()
  })
})
