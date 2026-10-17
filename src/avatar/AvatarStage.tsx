import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { normalizeSpec, type AvatarSpec, type Catalog } from './catalog'
import type { AvatarStudio, StudioState } from './studio'

export interface AvatarStageHandle {
  rotate(radians: number): void
}

interface AvatarStageProps {
  spec: AvatarSpec | null
  catalog: Catalog | null
  label: string
  reducedMotion: boolean
  ref?: Ref<AvatarStageHandle>
}

type StudioModule = typeof import('./studio')

let studioModule: Promise<StudioModule> | null = null
const loadStudioModule = () => (studioModule ??= import('./studio'))

const messages: Partial<Record<StudioState, string>> = {
  loading: 'Cargando personaje…',
  error: 'No se pudo cargar el personaje.',
  unsupported: 'La vista 3D no está disponible en este navegador.',
}

/** Vista 3D del personaje. El renderer se comparte entre todas las pantallas. */
export default function AvatarStage({ spec, catalog, label, reducedMotion, ref }: AvatarStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const studioRef = useRef<AvatarStudio | null>(null)
  const [state, setState] = useState<StudioState>('loading')

  useImperativeHandle(ref, () => ({
    rotate: (radians: number) => studioRef.current?.rotate(radians),
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void loadStudioModule().then(({ getStudio }) => {
      if (cancelled) return
      const studio = getStudio()
      studioRef.current = studio
      unsubscribe = studio.subscribe(setState)
      studio.mount(host)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
      const studio = studioRef.current
      if (studio) studio.unmount(host)
      studioRef.current = null
    }
  }, [])

  useEffect(() => {
    studioRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion, state])

  const specKey = spec ? JSON.stringify(spec) : ''
  useEffect(() => {
    if (!spec || !catalog) return
    let cancelled = false
    const normalized = normalizeSpec(spec, catalog)
    void loadStudioModule().then(({ getStudio }) => {
      if (cancelled) return
      const studio = getStudio()
      studioRef.current = studio
      studio.setReducedMotion(reducedMotion)
      return studio.setAvatar(normalized, catalog)
    })
    return () => {
      cancelled = true
    }
    // reducedMotion se aplica en su propio efecto; spec se compara por contenido (specKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, catalog])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      studioRef.current?.rotate(-0.4)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      studioRef.current?.rotate(0.4)
    }
  }

  return (
    <div
      className="avatar-stage"
      role="group"
      aria-label={`${label}. Usa las flechas izquierda y derecha para girar.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {messages[state] && (
        <p className="preview-error" role="status" style={{ position: 'absolute', inset: 'auto 10px 45px' }}>
          {messages[state]}
        </p>
      )}
    </div>
  )
}
