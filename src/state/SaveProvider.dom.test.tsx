// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveProvider, useSave } from './SaveProvider'
import { STORAGE_KEY, emptySave } from './save'

const wrapper = ({ children }: { children: ReactNode }) => <SaveProvider>{children}</SaveProvider>

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SaveProvider con varias pestañas', () => {
  it('adopta lo que guarda otra pestaña y no lo pisa con su estado anticuado', () => {
    const { result } = renderHook(() => useSave(), { wrapper })
    expect(result.current.save.characters).toHaveLength(0)

    const other = { ...emptySave(), characters: [{ id: 'otra', name: 'Desde otra pestaña', spec: { cuerpo: 'x' } }], activeId: 'otra' }
    act(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(other))
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })
    expect(result.current.save.characters.map((c) => c.id)).toEqual(['otra'])

    act(() => result.current.setDifficulty('intensa'))
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(stored.difficulty).toBe('intensa')
    expect(stored.characters).toHaveLength(1)
  })

  it('ignora los cambios de otras claves del almacenamiento', () => {
    const { result } = renderHook(() => useSave(), { wrapper })
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'entrecalles-calidad' }))
    })
    expect(result.current.save.characters).toHaveLength(0)
  })
})
