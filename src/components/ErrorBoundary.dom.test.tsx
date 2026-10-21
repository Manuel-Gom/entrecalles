// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

afterEach(() => cleanup())

function Boom(): never {
  throw new Error('fallo de prueba')
}

describe('ErrorBoundary', () => {
  it('muestra el contenido cuando no hay fallos', () => {
    render(<ErrorBoundary><p>todo bien</p></ErrorBoundary>)
    expect(screen.getByText('todo bien')).toBeTruthy()
  })

  it('ante un fallo al dibujar muestra un aviso accesible en lugar de dejar la página en blanco', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('Algo ha fallado')
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeTruthy()
    error.mockRestore()
  })

  it('al cambiar de pantalla (por ejemplo con Atrás) vuelve a intentar dibujar', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let broken = true
    function Flaky() {
      if (broken) throw new Error('fallo de prueba')
      return <p>recuperada</p>
    }
    render(<ErrorBoundary><Flaky /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    broken = false
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByText('recuperada')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    error.mockRestore()
  })
})
