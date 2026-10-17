import { useEffect, useRef } from 'react'
import { AvatarView } from '../components/AvatarView'
import { DIFFICULTIES } from '../state/save'
import { useCatalog } from '../state/CatalogProvider'
import { useSave } from '../state/SaveProvider'
import { paths } from '../router'

export function HomeScreen() {
  const { save, activeCharacter } = useSave()
  const { catalog } = useCatalog()
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = 'Entrecalles · La calle también es tuya'
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  const previewSpec = activeCharacter?.spec ?? { cuerpo: catalog?.cuerpos[0]?.id ?? 'marcos' }

  return (
    <div className="wrap home">
      <div className="home-copy">
        <p className="label accent">Menú previo · Una ciudad, mil historias</p>
        <h1 id="page-title" ref={titleRef} tabIndex={-1} className="home-title">
          La calle también <span className="accent">es tuya.</span>
        </h1>
        <p className="home-lead">Crea a tu protagonista, elige el reto y ajusta la partida antes de salir a la calle.</p>

        <div className="home-actions">
          {activeCharacter ? (
            <>
              <a className="btn" href={paths.dificultad}>Continuar con {activeCharacter.name} <span aria-hidden="true">→</span></a>
              <a className="btn btn-ghost" href={paths.nuevo}>Crear personaje</a>
            </>
          ) : (
            <>
              <a className="btn" href={paths.nuevo}>Crear protagonista <span aria-hidden="true">→</span></a>
              {save.characters.length > 0 && <a className="btn btn-ghost" href={paths.personajes}>Ver personajes</a>}
            </>
          )}
        </div>

        <section className="card checklist" aria-labelledby="preparacion">
          <h2 id="preparacion" className="label">Tu preparación</h2>
          <ol>
            <li className={activeCharacter ? 'done' : ''}>
              <span className="mark" aria-hidden="true">{activeCharacter ? '✓' : '1'}</span>
              <span className="name">Personaje</span>
              <span className="value">{activeCharacter?.name ?? 'Por crear'}</span>
            </li>
            <li>
              <span className="mark" aria-hidden="true">2</span>
              <span className="name">Dificultad</span>
              <span className="value">{DIFFICULTIES[save.difficulty].title}</span>
            </li>
            <li>
              <span className="mark" aria-hidden="true">3</span>
              <span className="name">Ajustes</span>
              <span className="value">Audio, controles y accesibilidad</span>
            </li>
          </ol>
        </section>
      </div>

      <div className="home-visual">
        <AvatarView
          spec={previewSpec}
          label={activeCharacter ? `Vista 3D de ${activeCharacter.name}` : 'Vista 3D de ejemplo'}
          tag={activeCharacter ? `${activeCharacter.name} · protagonista` : 'Vista de ejemplo'}
          tagRight="Estudio 3D"
        />
      </div>
    </div>
  )
}
