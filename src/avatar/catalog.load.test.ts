import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { miniCatalog } from '../test/fixtures'

// loadCatalog guarda el resultado en el módulo: cada prueba lo importa de nuevo
async function freshModule() {
  vi.resetModules()
  return import('./catalog')
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadCatalog', () => {
  it('descarga el catálogo una sola vez y lo reutiliza', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => miniCatalog }))
    vi.stubGlobal('fetch', fetchMock)
    const { loadCatalog } = await freshModule()
    const [first, second] = await Promise.all([loadCatalog(), loadCatalog()])
    expect(first).toEqual(miniCatalog)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/models\/modular\/manifest\.json$/)
  })

  it('si falla la descarga, avisa con un error y permite reintentar', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => miniCatalog })
    vi.stubGlobal('fetch', fetchMock)
    const { loadCatalog } = await freshModule()
    await expect(loadCatalog()).rejects.toThrow('404')
    await expect(loadCatalog()).resolves.toEqual(miniCatalog)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('si la red falla, el error se propaga y se puede reintentar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce({ ok: true, json: async () => miniCatalog }))
    const { loadCatalog } = await freshModule()
    await expect(loadCatalog()).rejects.toThrow('sin red')
    await expect(loadCatalog()).resolves.toBeDefined()
  })
})
