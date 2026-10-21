import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Comportamiento de un diálogo modal mientras `active`: vuelve inerte lo que hay detrás, atrapa el foco
 * (empezando por el elemento con data-autofocus), se cierra con Escape y devuelve el foco a quien lo abrió
 * (o adonde diga `restoreFocus`).
 */
export function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  background: () => Element[],
  active = true,
  restoreFocus: (opener: HTMLElement | null) => void = (opener) => opener?.focus(),
) {
  const latest = useRef({ onClose, background, restoreFocus })
  latest.current = { onClose, background, restoreFocus }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!active || !dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inert = latest.current.background()
    inert.forEach((element) => element.setAttribute('inert', ''))
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    ;(dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        latest.current.onClose()
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
      inert.forEach((element) => element.removeAttribute('inert'))
      latest.current.restoreFocus(opener)
    }
  }, [active, dialogRef])
}
