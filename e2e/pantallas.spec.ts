import AxeBuilder from '@axe-core/playwright'
import { emptySave, expect, test, withCharacters, type SaveSeed } from './fixtures'

const pantallas: [nombre: string, ruta: string, estado: SaveSeed][] = [
  ['inicio', '/#/', withCharacters],
  ['personajes', '/#/personajes', withCharacters],
  ['biblioteca vacía', '/#/personajes', emptySave],
  ['editor', '/#/personajes/a', withCharacters],
  ['dificultad', '/#/dificultad', withCharacters],
  ['ajustes', '/#/ajustes', withCharacters],
  ['resumen', '/#/resumen', withCharacters],
  ['personajes no jugables', '/#/pnj', withCharacters],
]

for (const [nombre, ruta, estado] of pantallas) {
  test(`${nombre}: sin desbordamiento, foco en el título y sin problemas de accesibilidad`, async ({ page, sembrar }, info) => {
    await sembrar(estado)
    await page.goto(ruta)
    await page.waitForSelector('h1')
    if (await page.locator('.stage').count()) {
      await page.waitForFunction(() => window.__avatarStudio?.().stats().state === 'ready', null, { timeout: 90_000 })
    }
    if (nombre === 'personajes no jugables') await page.waitForSelector('.npc-card')

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'desbordamiento horizontal').toBe(0)
    await expect(page.locator('#page-title')).toBeFocused()

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(axe.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`), 'violaciones de accesibilidad').toEqual([])

    await page.screenshot({ path: info.outputPath(`${nombre.replace(/\s/g, '-')}.png`), fullPage: true })
  })
}
