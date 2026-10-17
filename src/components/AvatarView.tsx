import { lazy, Suspense, useRef } from 'react'
import type { AvatarStageHandle } from '../avatar/AvatarStage'
import type { AvatarSpec } from '../avatar/catalog'
import { useCatalog } from '../state/CatalogProvider'
import { useSave } from '../state/SaveProvider'

const AvatarStage = lazy(() => import('../avatar/AvatarStage'))

interface AvatarViewProps {
  spec: AvatarSpec | null
  label: string
  /** texto pequeño arriba a la izquierda */
  tag?: string
  tagRight?: string
  controls?: boolean
}

/** Vista 3D del personaje con sus controles de giro. */
export function AvatarView({ spec, label, tag, tagRight, controls = true }: AvatarViewProps) {
  const { catalog } = useCatalog()
  const { save } = useSave()
  const stageRef = useRef<AvatarStageHandle>(null)
  const turn = (direction: number) => stageRef.current?.rotate(direction * 0.4)

  return (
    <div className="stage">
      {tag && <p className="label stage-tag">{tag}</p>}
      {tagRight && <p className="label stage-tag right">{tagRight}</p>}
      <div className="stage-canvas">
        <Suspense fallback={<p className="stage-message" role="status">Cargando vista 3D…</p>}>
          <AvatarStage ref={stageRef} spec={spec} catalog={catalog} label={label} reducedMotion={save.settings.reducedMotion} />
        </Suspense>
      </div>
      {controls && (
        <div className="stage-controls">
          <span className="stage-hint">Arrastra para girar</span>
          <span className="rotate">
            <button type="button" className="icon-btn" onClick={() => turn(-1)} aria-label="Girar a la izquierda">←</button>
            <button type="button" className="icon-btn" onClick={() => turn(1)} aria-label="Girar a la derecha">→</button>
          </span>
        </div>
      )}
    </div>
  )
}
