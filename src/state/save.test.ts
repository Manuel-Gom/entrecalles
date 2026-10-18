import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIFFICULTIES, MAX_CHARACTERS, NAME_MAX, STORAGE_KEY, emptySave, newId, readSave, writeSave } from './save'

/** localStorage en memoria (el entorno de pruebas no tiene navegador). */
function installStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: (key: string) => void data.delete(key),
  }
  vi.stubGlobal('localStorage', storage)
  return { data, storage }
}

beforeEach(() => {
  installStorage()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const character = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Personaje ${id}`, spec: { cuerpo: 'marcos' }, ...extra })

describe('readSave', () => {
  it('sin nada guardado devuelve el estado inicial', () => {
    expect(readSave()).toEqual(emptySave())
  })

  it('con JSON roto no lanza y devuelve el estado inicial', () => {
    installStorage({ [STORAGE_KEY]: '{esto no es json' })
    expect(readSave()).toEqual(emptySave())
  })

  it('si lo guardado no es un objeto, empieza de cero', () => {
    for (const raw of ['null', '42', '"texto"', '[]']) {
      installStorage({ [STORAGE_KEY]: raw })
      expect(readSave().characters).toEqual([])
    }
  })

  it('lee un guardado v2 válido', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({
      version: 2, characters: [character('a', { spec: { cuerpo: 'lucia', pelo: null, colorPelo: '#4a2f1f', torso: 'x' } })],
      activeId: 'a', difficulty: 'intensa', settings: { masterVolume: 30, controlPreset: 'flechas', highContrast: true },
    }) })
    const save = readSave()
    expect(save.characters).toHaveLength(1)
    expect(save.characters[0].spec).toEqual({ cuerpo: 'lucia', pelo: null, colorPelo: '#4a2f1f', torso: 'x' })
    expect(save.activeId).toBe('a')
    expect(save.difficulty).toBe('intensa')
    expect(save.settings).toMatchObject({ masterVolume: 30, controlPreset: 'flechas', highContrast: true, subtitles: true })
  })

  it('migra el formato v1 (model → spec, zurdo → flechas)', () => {
    installStorage({ ['entrecalles-save-v1']: JSON.stringify({
      characters: [{ id: 'v1', name: 'Antiguo', model: 'kenji', face: 'cálido', hair: 'corto' }],
      activeId: 'v1', difficulty: 'relajada', settings: { controlPreset: 'zurdo', masterVolume: 55 },
    }) })
    const save = readSave()
    expect(save.version).toBe(2)
    expect(save.characters[0]).toEqual({ id: 'v1', name: 'Antiguo', spec: { cuerpo: 'kenji' } })
    expect(save.settings.controlPreset).toBe('flechas')
    expect(save.settings.masterVolume).toBe(55)
    expect(save.difficulty).toBe('relajada')
  })

  it('el formato v2 tiene prioridad sobre el v1', () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({ characters: [character('nuevo')], activeId: null }),
      ['entrecalles-save-v1']: JSON.stringify({ characters: [{ id: 'viejo', name: 'V', model: 'marcos' }] }),
    })
    expect(readSave().characters.map((c) => c.id)).toEqual(['nuevo'])
  })

  it('descarta personajes mal formados', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [
      null, 5, 'x', { id: 5, name: 'Sin id válido', spec: { cuerpo: 'a' } }, { id: 'a' }, { id: 'b', name: 'Sin spec' },
      { id: 'c', name: 'Cuerpo no texto', spec: { cuerpo: 7 } }, character('ok'),
    ] }) })
    expect(readSave().characters.map((c) => c.id)).toEqual(['ok'])
  })

  it('descarta identificadores repetidos', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [character('a'), character('a'), character('b')] }) })
    expect(readSave().characters.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it(`recorta los nombres a ${NAME_MAX} caracteres`, () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [{ ...character('a'), name: 'x'.repeat(100) }] }) })
    expect(readSave().characters[0].name).toHaveLength(NAME_MAX)
  })

  it(`guarda como máximo ${MAX_CHARACTERS} personajes`, () => {
    const many = Array.from({ length: 20 }, (_, index) => character(`p${index}`))
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: many }) })
    expect(readSave().characters).toHaveLength(MAX_CHARACTERS)
  })

  it('un activeId que no existe pasa a null', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [character('a')], activeId: 'fantasma' }) })
    expect(readSave().activeId).toBeNull()
  })

  it('una dificultad desconocida vuelve a la equilibrada', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ difficulty: 'imposible' }) })
    expect(readSave().difficulty).toBe('equilibrada')
    expect(Object.keys(DIFFICULTIES)).toContain(readSave().difficulty)
  })

  it('limita los volúmenes a 0-100 y usa el valor por defecto si no son números', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ settings: { masterVolume: 500, musicVolume: -20, effectsVolume: 'alto' } }) })
    expect(readSave().settings).toMatchObject({ masterVolume: 100, musicVolume: 0, effectsVolume: 80 })
  })

  it('los ajustes con tipos erróneos se sustituyen por los de por defecto', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ settings: { subtitles: 'sí', highContrast: 1, controlPreset: 'otro' } }) })
    expect(readSave().settings).toMatchObject({ subtitles: true, highContrast: false, controlPreset: 'clasico' })
  })

  it('solo acepta retratos que sean imágenes en data URL', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [
      character('a', { thumb: 'data:image/webp;base64,AAAA' }), character('b', { thumb: 'https://ejemplo.com/x.png' }), character('c', { thumb: 12 }),
    ] }) })
    const [a, b, c] = readSave().characters
    expect(a.thumb).toBe('data:image/webp;base64,AAAA')
    expect(b.thumb).toBeUndefined()
    expect(c.thumb).toBeUndefined()
  })

  it('ignora campos desconocidos de la especificación del aspecto', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [character('a', { spec: { cuerpo: 'x', pelo: 5, torso: 'ok', raro: true } })] }) })
    expect(readSave().characters[0].spec).toEqual({ cuerpo: 'x', torso: 'ok' })
  })

  it('conserva gafas, barba y colores de tela al leer', () => {
    const spec = { cuerpo: 'marcos', gafas: 'g1', barba: null, colores: { torso: '#202225', calzado: '#f4f4f0' } }
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [character('a', { spec })] }) })
    expect(readSave().characters[0].spec).toEqual(spec)
  })

  it('descarta colores de tela mal formados', () => {
    const spec = { cuerpo: 'marcos', colores: { torso: 7, raro: '#fff' } }
    installStorage({ [STORAGE_KEY]: JSON.stringify({ characters: [character('a', { spec })] }) })
    expect(readSave().characters[0].spec).toEqual({ cuerpo: 'marcos' })
  })

  it('si localStorage lanza al leer, devuelve el estado inicial', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado') } })
    expect(readSave()).toEqual(emptySave())
  })
})

describe('writeSave', () => {
  it('guarda y se puede volver a leer igual', () => {
    const { data } = installStorage()
    const save = { ...emptySave(), characters: [{ id: 'a', name: 'Ana', spec: { cuerpo: 'lucia', pelo: null } }], activeId: 'a' }
    expect(writeSave(save)).toBe(true)
    expect(data.has(STORAGE_KEY)).toBe(true)
    expect(readSave()).toEqual(save)
  })

  it('devuelve false si el almacenamiento falla (cuota llena o bloqueado)', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new DOMException('lleno', 'QuotaExceededError') } })
    expect(writeSave(emptySave())).toBe(false)
  })
})

describe('newId', () => {
  it('genera identificadores distintos', () => {
    expect(newId()).not.toBe(newId())
  })
})
