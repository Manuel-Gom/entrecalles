import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose: () => void
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Diálogo modal accesible: atrapa el foco, se cierra con Escape y devuelve el foco a quien lo abrió. */
export function Dialog({ title, children, actions, onClose }: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    // el foco empieza en la opción segura (la que lleva data-autofocus)
    ;(dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      } else if (event.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      root?.removeAttribute('inert')
      opener?.focus()
    }
  }, [])

  // en el <body>, fuera del #root que se vuelve inerte mientras el diálogo está abierto
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-icon" aria-hidden="true">!</div>
        <p className="label" style={{ marginTop: '1.5rem' }}>Confirmar acción</p>
        <h2 id="dialog-title">{title}</h2>
        {children}
        <div className="actions">{actions}</div>
        <p className="label" style={{ marginTop: '1.25rem' }}>Esc para cancelar</p>
      </section>
    </div>,
    document.body,
  )
}
