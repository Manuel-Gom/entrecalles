import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/** Última red de seguridad: ante un fallo al dibujar, avisa en lugar de dejar la página en blanco. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error al dibujar la aplicación.', error, info.componentStack)
  }

  // cambiar de pantalla (Atrás del navegador, un enlace) vuelve a intentar dibujar la aplicación
  componentDidMount() {
    window.addEventListener('hashchange', this.reset)
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.reset)
  }

  private reset = () => {
    if (this.state.failed) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="alert-banner" role="alert" style={{ margin: '2rem auto', maxWidth: '36rem', padding: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem' }}>Algo ha fallado</h1>
        <p>No se pudo mostrar esta pantalla. Tus personajes y ajustes siguen guardados en este navegador.</p>
        <p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Recargar</button>{' '}
          <a className="btn btn-ghost" href="#/" onClick={this.reset}>Ir al inicio</a>
        </p>
      </main>
    )
  }
}
