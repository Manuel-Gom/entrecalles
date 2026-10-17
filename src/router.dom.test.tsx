// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { navigate, paths, useRoute } from './router'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('useRoute y navigate', () => {
  it('lee la ruta actual del fragmento de la URL', () => {
    window.location.hash = '#/dificultad'
    const { result } = renderHook(() => useRoute())
    expect(result.current).toEqual({ name: 'dificultad' })
  })

  it('cambia cuando cambia la URL (botón Atrás, enlaces, navigate)', async () => {
    const { result } = renderHook(() => useRoute())
    expect(result.current.name).toBe('inicio')
    await act(async () => {
      navigate(paths.editar('abc'))
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current).toEqual({ name: 'editar', id: 'abc' })
    await act(async () => {
      window.location.hash = '#/pnj'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current).toEqual({ name: 'pnj' })
  })

  it('navigate escribe la ruta en la URL', () => {
    navigate(paths.nuevo)
    expect(window.location.hash).toBe('#/personajes/nuevo')
  })
})
