import { describe, expect, it } from 'vitest'
import { parseHash, paths } from './router'

describe('parseHash', () => {
  it.each([
    ['', { name: 'inicio' }],
    ['#', { name: 'inicio' }],
    ['#/', { name: 'inicio' }],
    ['#/personajes', { name: 'personajes' }],
    ['#/personajes/', { name: 'personajes' }],
    ['#/personajes/nuevo', { name: 'nuevo' }],
    ['#/personajes/abc-123', { name: 'editar', id: 'abc-123' }],
    ['#/dificultad', { name: 'dificultad' }],
    ['#/ajustes', { name: 'ajustes' }],
    ['#/resumen', { name: 'resumen' }],
    ['#/pnj', { name: 'pnj' }],
  ])('%s → %o', (hash, route) => {
    expect(parseHash(hash)).toEqual(route)
  })

  it('las rutas desconocidas llevan al inicio', () => {
    expect(parseHash('#/no-existe')).toEqual({ name: 'inicio' })
    expect(parseHash('#/personajes/../x/y')).toEqual({ name: 'editar', id: '..' })
  })

  it('decodifica los identificadores con caracteres especiales', () => {
    expect(parseHash(paths.editar('a b/ñ'))).toEqual({ name: 'editar', id: 'a b/ñ' })
  })

  it('cada ruta de paths se interpreta como su pantalla', () => {
    expect(parseHash(paths.inicio).name).toBe('inicio')
    expect(parseHash(paths.personajes).name).toBe('personajes')
    expect(parseHash(paths.nuevo).name).toBe('nuevo')
    expect(parseHash(paths.dificultad).name).toBe('dificultad')
    expect(parseHash(paths.ajustes).name).toBe('ajustes')
    expect(parseHash(paths.resumen).name).toBe('resumen')
    expect(parseHash(paths.pnj).name).toBe('pnj')
  })
})
