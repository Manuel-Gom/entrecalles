import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalFocus } from './useModalFocus'

interface DialogProps {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose: () => void
}

/** Diálogo modal accesible: atrapa el foco, se cierra con Escape y devuelve el foco a quien lo abrió. */
export function Dialog({ title, children, actions, onClose }: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  // el foco empieza en la opción segura (la que lleva data-autofocus); lo inerte es el #root entero
  useModalFocus(dialogRef, onClose, () => [document.getElementById('root')].filter((element) => element !== null))

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
