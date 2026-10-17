import { expect, settings, test, withCharacters } from './fixtures'

test('lo guardado sobrevive a recargar, incluida la dificultad y los ajustes', async ({ page, sembrar }) => {
  await sembrar(withCharacters)
  await page.goto('/#/dificultad')
  await page.getByRole('radio', { name: /Sin red/ }).click()
  await page.goto('/#/ajustes')
  await page.getByRole('switch', { name: /Subtítulos/ }).uncheck({ force: true })
  await page.reload()
  await expect(page.getByRole('switch', { name: /Subtítulos/ })).not.toBeChecked()
  await page.goto('/#/dificultad')
  await expect(page.getByRole('radio', { name: /Sin red/ })).toHaveAttribute('aria-checked', 'true')
})

test('un guardado antiguo (v1) se migra al abrir la aplicación', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('sembrado')) {
      localStorage.setItem('entrecalles-save-v1', JSON.stringify({
        characters: [{ id: 'viejo', name: 'Antiguo', model: 'kenji', face: 'cálido', hair: 'corto', outfit: 'urbana', palette: 'lima' }],
        activeId: 'viejo', difficulty: 'intensa', settings: { controlPreset: 'zurdo', masterVolume: 40 },
      }))
      sessionStorage.setItem('sembrado', '1')
    }
  })
  await page.goto('/#/personajes')
  await expect(page.locator('.character-row h2', { hasText: 'Antiguo' })).toBeVisible()
  await page.goto('/#/ajustes')
  await expect(page.getByRole('radio', { name: 'Flechas', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.goto('/#/dificultad')
  await expect(page.getByRole('radio', { name: /Sin red/ })).toHaveAttribute('aria-checked', 'true')
  // al guardar de nuevo, ya queda en el formato nuevo
  await page.goto('/#/dificultad')
  await page.getByRole('radio', { name: /En la calle/ }).click()
  const v2 = await page.evaluate(() => JSON.parse(localStorage.getItem('entrecalles-save-v2')!))
  expect(v2.version).toBe(2)
  expect(v2.characters[0].spec.cuerpo).toBe('kenji')
})

test('datos guardados dañados no rompen la aplicación', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('entrecalles-save-v2', '{"characters":[{"id":5},{"id":"x","name":"Raro","spec":{"cuerpo":"no-existe"}}],"settings":{"masterVolume":"alto"}}')
  })
  await page.goto('/#/personajes')
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.locator('.character-row h2', { hasText: 'Raro' })).toBeVisible() // el cuerpo desconocido se sustituye por uno válido
})

test('si el almacenamiento está lleno se avisa y la aplicación sigue funcionando', async ({ page, sembrar, ignorarConsola }) => {
  void ignorarConsola
  await sembrar(withCharacters)
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'entrecalles-save-v2' && sessionStorage.getItem('sembrado') && sessionStorage.getItem('llenar')) {
        throw new DOMException('lleno', 'QuotaExceededError')
      }
      return original.call(this, key, value)
    }
  })
  await page.goto('/#/dificultad')
  await page.evaluate(() => sessionStorage.setItem('llenar', '1'))
  await page.getByRole('radio', { name: /Sin red/ }).click()
  await expect(page.getByText('No se puede guardar en este navegador')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Sin red/ })).toHaveAttribute('aria-checked', 'true')
})

test('un retrato guardado que no es una imagen se descarta', async ({ page, sembrar }) => {
  await sembrar({ ...withCharacters, characters: [{ id: 'a', name: 'Marcos', spec: { cuerpo: 'marcos' }, thumb: 'javascript:alert(1)' }], settings })
  await page.goto('/#/personajes')
  await expect(page.locator('.character-row h2', { hasText: 'Marcos' })).toBeVisible()
  expect(await page.locator('.character-row img[src^="javascript"]').count()).toBe(0)
})
