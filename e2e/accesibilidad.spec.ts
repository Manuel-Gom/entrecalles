import AxeBuilder from '@axe-core/playwright'
import { expect, settings, test, withCharacters } from './fixtures'

const modos = [
  ['alto contraste', { highContrast: true }],
  ['texto grande', { largeText: true }],
  ['movimiento reducido', { reducedMotion: true }],
] as const

for (const [nombre, cambios] of modos) {
  test(`${nombre}: el editor y los ajustes siguen cumpliendo WCAG 2.1 AA`, async ({ page, sembrar }) => {
    await sembrar({ ...withCharacters, settings: { ...settings, ...cambios } })
    for (const ruta of ['/#/personajes/a', '/#/ajustes']) {
      await page.goto(ruta)
      await page.waitForSelector('h1')
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(axe.violations.map((v) => `${v.id}: ${v.help}`), `${nombre} en ${ruta}`).toEqual([])
    }
  })
}

test('el ajuste de movimiento reducido apaga las animaciones de la interfaz', async ({ page, sembrar }) => {
  await sembrar({ ...withCharacters, settings: { ...settings, reducedMotion: true } })
  await page.goto('/#/personajes')
  await expect(page.locator('html')).toHaveClass(/reduced-motion/)
  const duracion = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')!).transitionDuration)
  expect(parseFloat(duracion)).toBeLessThan(0.01)
})

test('la preferencia del sistema de movimiento reducido se respeta al empezar de cero', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveClass(/reduced-motion/)
})

test('el enlace "Saltar al contenido" lleva el foco al título', async ({ page, sembrar }) => {
  await sembrar(withCharacters)
  await page.goto('/#/personajes')
  // al entrar en una pantalla el foco está en el título: un clic arriba a la izquierda reinicia la navegación desde el principio
  await page.mouse.click(2, 2)
  await page.keyboard.press('Tab')
  const enlace = page.getByRole('link', { name: 'Saltar al contenido' })
  await expect(enlace).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#page-title')).toBeFocused()
})

test('el editor se maneja entero con el teclado', async ({ page, sembrar, visor }) => {
  await sembrar(withCharacters)
  await page.goto('/#/personajes/a')
  await visor.listo('marcos')

  // pestañas: flechas, Inicio y Fin
  await page.getByRole('tab', { name: 'Cuerpo', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Pelo', exact: true })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Pelo', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Colores', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: 'Cuerpo', exact: true })).toHaveAttribute('aria-selected', 'true')

  // el visor se gira con las flechas cuando tiene el foco
  await page.locator('.avatar-stage').focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.avatar-stage')).toBeFocused()

  // en un grupo de opciones solo la elegida entra con Tab
  await page.getByRole('tab', { name: 'Pelo', exact: true }).click()
  const grupo = page.getByRole('radiogroup', { name: 'Peinado', exact: true })
  const tabulables = await grupo.getByRole('radio').evaluateAll((radios) => radios.filter((radio) => (radio as HTMLElement).tabIndex === 0).length)
  expect(tabulables).toBe(1)
})
