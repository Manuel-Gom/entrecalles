import { useEffect, useRef, type ReactNode } from 'react'
import { useSave } from '../state/SaveProvider'
import { navigate, paths, type Route } from '../router'

type StepId = 'personaje' | 'dificultad' | 'ajustes' | 'resumen'

const STEPS: { id: StepId; label: string; path: string }[] = [
  { id: 'personaje', label: 'Personaje', path: paths.personajes },
  { id: 'dificultad', label: 'Dificultad', path: paths.dificultad },
  { id: 'ajustes', label: 'Ajustes', path: paths.ajustes },
  { id: 'resumen', label: 'Resumen', path: paths.resumen },
]

export const stepOf = (route: Route): StepId | null => {
  switch (route.name) {
    case 'personajes':
    case 'nuevo':
    case 'editar':
      return 'personaje'
    case 'dificultad':
    case 'ajustes':
    case 'resumen':
      return route.name
    default:
      return null
  }
}

function TopBar({ route }: { route: Route }) {
  const { storageError, activeCharacter } = useSave()
  const current = stepOf(route)
  const currentIndex = STEPS.findIndex((step) => step.id === current)

  return (
    <header className="topbar">
      <a className="logo" href={paths.inicio} aria-label="Entrecalles, inicio">
        <span className="logo-mark" aria-hidden="true">E</span>
        <span>ENTRE<span className="logo-light">CALLES</span></span>
      </a>

      {current === null ? (
        <nav className="main-nav" aria-label="Principal">
          <a href={paths.inicio} aria-current={route.name === 'inicio' ? 'page' : undefined}>Inicio</a>
          <a href={paths.personajes}>Personajes</a>
          <a href={activeCharacter ? paths.dificultad : paths.personajes}>Preparar partida</a>
        </nav>
      ) : (
        <nav aria-label="Pasos de la preparación">
          <ol className="stepper">
            {STEPS.map((step, index) => {
              const done = index < currentIndex
              const isCurrent = index === currentIndex
              // los pasos posteriores al primero necesitan un personaje elegido
              const reachable = index === 0 || activeCharacter !== null
              return (
                <li className={`step${isCurrent ? ' is-current' : ''}${done ? ' is-done' : ''}`} key={step.id}>
                  {reachable ? (
                    <a href={step.path} aria-current={isCurrent ? 'step' : undefined}>
                      <b aria-hidden="true">{done ? '✓' : index + 1}</b>
                      {step.label}
                      {done && <span className="sr-only"> (completado)</span>}
                    </a>
                  ) : (
                    <span className="step-inner"><b aria-hidden="true">{index + 1}</b>{step.label}</span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <span className={`save-status${storageError ? ' is-error' : ''}`} role={storageError ? 'alert' : undefined}>
        <i aria-hidden="true" />
        {storageError ? 'No se puede guardar en este navegador' : 'Guardado en este dispositivo'}
      </span>
    </header>
  )
}

/** Marco común: barra superior, contenido y pie. */
export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="app">
      <a className="skip-link" href="#contenido" onClick={(event) => { event.preventDefault(); document.getElementById('page-title')?.focus() }}>
        Saltar al contenido
      </a>
      <div className="wrap">
        <TopBar route={route} />
      </div>
      <main id="contenido">{children}</main>
      <div className="wrap">
        <footer className="site-footer">
          <span>© Entrecalles — una historia original</span>
          <a href={paths.pnj}>Galería de personajes no jugables</a>
          <span>Versión 0.2</span>
        </footer>
      </div>
    </div>
  )
}

interface PageProps {
  title: ReactNode
  /** texto de la pestaña del navegador y del anuncio a lectores de pantalla */
  plainTitle: string
  lead?: string
  back?: { label: string; href: string }
  actions?: ReactNode
  children: ReactNode
}

/** Cabecera de página: el título recibe el foco al entrar, para que se anuncie el cambio de pantalla. */
export function Page({ title, plainTitle, lead, back, actions, children }: PageProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = `${plainTitle} · Entrecalles`
    titleRef.current?.focus({ preventScroll: true })
  }, [plainTitle])

  return (
    <div className="wrap page">
      <div className="head-row">
        <div className="page-head">
          {back && (
            <a className="back-link" href={back.href} onClick={(event) => { event.preventDefault(); navigate(back.href) }}>
              <span aria-hidden="true" className="accent">←</span> {back.label}
            </a>
          )}
          <h1 id="page-title" ref={titleRef} tabIndex={-1} className="page-title">{title}</h1>
          {lead && <p className="page-lead">{lead}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}
