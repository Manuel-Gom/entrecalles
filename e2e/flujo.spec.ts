import { emptySave, expect, test, withCharacters } from './fixtures'

test.describe('navegación', () => {
  test('inicio, enlace directo, botón Atrás y foco en el título', async ({ page, sembrar, visor }) => {
    await sembrar(withCharacters)
    await page.goto('/')
    await visor.listo()
    await expect(page.locator('h1')).toContainText('La calle')

    await page.getByRole('link', { name: /Continuar con Marcos/ }).click()
    await expect(page).toHaveURL(/#\/dificultad$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/(#\/)?$/)

    await page.goto('/#/personajes/a')
    await expect(page.locator('h1')).toContainText('detalle')
    await expect(page.locator('#page-title')).toBeFocused()
  })

  test('sin personaje, los pasos de la preparación redirigen a la biblioteca vacía', async ({ page, sembrar }) => {
    await sembrar(emptySave)
    await page.goto('/#/resumen')
    await expect(page).toHaveURL(/#\/personajes$/)
    await expect(page.getByText('Aún no hay nadie en tu elenco')).toBeVisible()
  })

  test('un personaje que no existe lleva a la biblioteca con un aviso', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await page.goto('/#/personajes/no-existe')
    await expect(page).toHaveURL(/#\/personajes$/)
    await expect(page.getByText('No se encuentra ese personaje.')).toBeVisible()
  })
})

test.describe('editor', () => {
  test('peinado, flechas, color de pelo, conjuntos y gorra se ven en el 3D', async ({ page, sembrar, visor }) => {
    await sembrar(withCharacters)
    await page.goto('/#/personajes/a')
    await visor.listo('marcos')
    const grupo = (nombre: string) => page.getByRole('radiogroup', { name: nombre, exact: true })

    await page.getByRole('tab', { name: 'Pelo', exact: true }).click()
    let stats = await visor.tras(() => grupo('Peinado').getByRole('radio', { name: 'Rizado', exact: true }).click())
    expect(stats.pieces.startsWith('afro01')).toBe(true)

    await grupo('Peinado').getByRole('radio', { checked: true }).focus()
    stats = await visor.tras(() => page.keyboard.press('ArrowRight'))
    expect(stats.pieces.startsWith('afro01')).toBe(false)

    await page.getByRole('tab', { name: 'Colores', exact: true }).click()
    await grupo('Color de pelo').getByRole('radio', { name: 'Gris', exact: true }).click()
    await expect(grupo('Color de pelo').getByRole('radio', { name: 'Gris', exact: true })).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('tab', { name: 'Ropa', exact: true }).click()
    stats = await visor.tras(() => grupo('Conjunto completo').getByRole('radio', { name: 'Traje con corbata', exact: true }).click())
    expect(stats.pieces).toContain('male_elegantsuit01')
    await expect(page.getByRole('radiogroup', { name: 'Camiseta o jersey' })).toHaveCount(0)
    await grupo('Conjunto completo').getByRole('radio', { name: 'Ninguno', exact: true }).click()
    await expect(page.getByRole('radiogroup', { name: 'Camiseta o jersey' })).toHaveCount(1)

    await page.getByRole('tab', { name: 'Calzado y gorra', exact: true }).click()
    stats = await visor.tras(() => grupo('Gorra o sombrero').getByRole('radio', { name: 'Gorra', exact: true }).click())
    expect(stats.pieces.startsWith('-,')).toBe(true) // la gorra oculta el peinado
    expect(stats.pieces).toContain('jujube_newsboy_cap')
  })

  test('cuerpos femeninos: solo ofrecen sus piezas y no pueden quedarse sin camiseta', async ({ page, sembrar, visor }) => {
    await sembrar(withCharacters)
    await page.goto('/#/personajes/nuevo')
    await visor.listo()
    await page.getByRole('radiogroup', { name: 'Tipo de cuerpo' }).getByRole('radio', { name: 'Mujeres' }).click()
    const stats = await visor.tras(() => page.getByRole('radiogroup', { name: 'Cuerpo', exact: true }).getByRole('radio', { name: 'Lucía', exact: true }).click())
    expect(stats.model).toBe('lucia')

    await page.getByRole('tab', { name: 'Ropa', exact: true }).click()
    await page.getByRole('radiogroup', { name: 'Conjunto completo', exact: true }).getByRole('radio', { name: 'Ninguno', exact: true }).click()
    const camisetas = page.getByRole('radiogroup', { name: 'Camiseta o jersey', exact: true })
    await expect(camisetas.getByRole('radio', { name: 'Ninguno', exact: true })).toHaveCount(0)
    await expect(camisetas.getByRole('radio', { name: 'Polo', exact: true })).toHaveCount(0)
    expect(await camisetas.getByRole('radio').count()).toBeGreaterThan(2)
  })

  test('aleatorio y restablecer siempre dejan un personaje completo', async ({ page, sembrar, visor }) => {
    await sembrar(withCharacters)
    await page.goto('/#/personajes/a')
    await visor.listo('marcos')
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: /Aleatorio/ }).click()
      await visor.listo()
      const { pieces } = await visor.stats()
      const [, torso, piernas, conjunto, calzado] = pieces.split(',')
      expect(calzado, 'sin calzado').not.toBe('-')
      expect(conjunto !== '-' || piernas !== '-', 'sin pantalón ni conjunto').toBe(true)
      void torso
    }
    await page.getByRole('button', { name: 'Restablecer' }).click()
    await expect(page.getByRole('radiogroup', { name: 'Cuerpo', exact: true }).getByRole('radio', { checked: true })).toHaveCount(1)
  })
})

test.describe('personajes guardados', () => {
  test('el nombre es obligatorio; al guardar se persiste el cambio y un retrato', async ({ page, sembrar, visor }) => {
    await sembrar(withCharacters)
    await page.goto('/#/personajes/a')
    await visor.listo('marcos')
    await page.getByRole('tab', { name: 'Calzado y gorra', exact: true }).click()
    await visor.tras(() => page.getByRole('radiogroup', { name: 'Gorra o sombrero', exact: true }).getByRole('radio', { name: 'Gorra', exact: true }).click())

    await page.locator('#nombre').fill('')
    await page.getByRole('button', { name: /Guardar personaje/ }).click()
    await expect(page.locator('#nombre-error')).toBeVisible()
    await expect(page.locator('#nombre')).toBeFocused()

    await page.locator('#nombre').fill('Marcos B')
    await page.getByRole('button', { name: /Guardar personaje/ }).click()
    await expect(page).toHaveURL(/#\/personajes$/)

    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('entrecalles-save-v2')!).characters.find((c: { id: string }) => c.id === 'a'))
    expect(guardado.name).toBe('Marcos B')
    expect(guardado.spec.cabeza).toBe('jujube_newsboy_cap')
    expect(guardado.thumb).toMatch(/^data:image\//)

    await page.reload()
    await expect(page.locator('.character-row h2', { hasText: 'Marcos B' })).toBeVisible()
  })

  test('eliminar pide confirmación y el diálogo atrapa el foco', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await page.goto('/#/personajes')
    const eliminar = page.getByRole('button', { name: 'Eliminar a Dani' })
    await eliminar.focus()
    await page.keyboard.press('Enter')

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(page.getByRole('button', { name: 'No, volver' })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(eliminar).toBeFocused()
    await expect(page.getByRole('heading', { name: 'Dani' })).toBeVisible()

    await eliminar.click()
    await page.getByRole('button', { name: 'Sí, eliminar' }).click()
    await expect(page.getByRole('heading', { name: 'Dani' })).toHaveCount(0)
  })

  test('el límite de personajes impide crear más', async ({ page, sembrar }) => {
    const ocho = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Personaje ${i}`, spec: { cuerpo: 'marcos' } }))
    await sembrar({ ...withCharacters, characters: ocho, activeId: 'p0' })
    await page.goto('/#/personajes')
    await expect(page.getByText(/límite de 8 personajes/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Crear personaje/ })).toHaveCount(0)
  })
})

test.describe('preparación de la partida', () => {
  test('dificultad, ajustes y resumen reflejan lo elegido', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await page.goto('/#/dificultad')
    await page.getByRole('radio', { name: /Sin red/ }).click()
    await expect(page.getByText('Efectos previstos · Sin red')).toBeVisible()

    await page.getByRole('link', { name: /Siguiente: ajustes/ }).click()
    await page.getByRole('radio', { name: 'Flechas', exact: true }).click()
    await page.getByRole('switch', { name: /Alto contraste/ }).check({ force: true })
    await expect(page.locator('html')).toHaveClass(/high-contrast/)
    await page.getByRole('switch', { name: /Texto grande/ }).check({ force: true })
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px')
    await page.getByRole('switch', { name: /Alto contraste/ }).uncheck({ force: true })
    await page.getByRole('switch', { name: /Texto grande/ }).uncheck({ force: true })

    await page.getByRole('link', { name: /Revisar partida/ }).click()
    await expect(page).toHaveURL(/#\/resumen$/)
    await expect(page.getByText('Sin red', { exact: true })).toBeVisible()
    await expect(page.getByText('Flechas', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Comenzar aventura/ }).click()
    await expect(page).toHaveURL(/#\/jugar$/)
    await expect(page.getByRole('heading', { name: /Explorando el barrio con/ })).toBeAttached()
  })

  test('las teclas de dificultad se mueven con flechas', async ({ page, sembrar }) => {
    await sembrar(withCharacters)
    await page.goto('/#/dificultad')
    await page.getByRole('radio', { name: /En la calle/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: /Sin red/ })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Home')
    await expect(page.getByRole('radio', { name: /A tu ritmo/ })).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('personajes no jugables', () => {
  test('la galería filtra, busca y muestra el elegido en 3D', async ({ page, sembrar, visor }) => {
    await sembrar(withCharacters)
    await page.goto('/#/pnj')
    await page.waitForSelector('.npc-card')
    expect(await page.locator('.npc-card').count()).toBeLessThanOrEqual(24)

    const npcs = await page.evaluate(() => fetch('/data/npcs.json').then((r) => r.json()))
    const mujeres = npcs.filter((n: { genero: string }) => n.genero === 'mujer').length
    await page.getByRole('radiogroup', { name: 'Género' }).getByRole('radio', { name: 'Mujeres' }).click()
    await expect(page.locator('p.label[role=status]').first()).toContainText(String(mujeres))

    await page.getByRole('searchbox').fill(npcs.find((n: { genero: string }) => n.genero === 'mujer').nombre.split(' ')[0])
    expect(await page.locator('.npc-card').count()).toBeGreaterThan(0)
    await page.getByRole('searchbox').fill('zzzzzz')
    await expect(page.getByText('No hay personajes con esos filtros.')).toBeVisible()
    await page.getByRole('searchbox').fill('')

    await visor.listo()
    await page.locator('.npc-card').nth(1).click()
    await expect(page.locator('.npc-card[aria-pressed="true"]')).toHaveCount(1)
    await visor.listo()
  })
})
