import { useState } from 'react'
import { describeSpec } from '../avatar/catalog'
import { AvatarView } from '../components/AvatarView'
import { Dialog } from '../components/Dialog'
import { Page } from '../components/Layout'
import { Thumb } from '../components/Thumb'
import { paths, navigate } from '../router'
import { MAX_CHARACTERS, type Character } from '../state/save'
import { useCatalog } from '../state/CatalogProvider'
import { useSave } from '../state/SaveProvider'
import { useToast } from '../state/ToastProvider'

export function CharactersScreen() {
  const { save, activeCharacter, selectCharacter, deleteCharacter } = useSave()
  const { catalog } = useCatalog()
  const notify = useToast()
  const [toDelete, setToDelete] = useState<Character | null>(null)
  const count = save.characters.length
  const full = count >= MAX_CHARACTERS

  const outfit = (character: Character) => (catalog ? describeSpec(character.spec, catalog) : '')

  const confirmDelete = () => {
    if (!toDelete) return
    deleteCharacter(toDelete.id)
    notify(`${toDelete.name} se ha eliminado.`)
    setToDelete(null)
  }

  const previewSpec = activeCharacter?.spec ?? { cuerpo: catalog?.cuerpos[0]?.id ?? 'marcos' }

  return (
    <Page
      plainTitle="Personajes"
      title={<>Tu gente, <span className="accent">tus reglas.</span></>}
      lead={`Elige quién lleva la historia. Puedes guardar hasta ${MAX_CHARACTERS} personajes.`}
      back={{ label: 'Volver al inicio', href: paths.inicio }}
      actions={count > 0 && !full ? <a className="btn" href={paths.nuevo}><span aria-hidden="true">＋</span> Crear personaje</a> : undefined}
    >
      <div className="layout-two">
        <section className="layout-main" aria-label="Biblioteca de personajes">
          {count === 0 ? (
            <div className="card empty">
              <div className="empty-icon" aria-hidden="true">＋</div>
              <h2>Aún no hay nadie en tu elenco</h2>
              <p>Crea tu primer personaje: elige cuerpo, peinado y ropa. Se guarda en este dispositivo y podrás editarlo cuando quieras.</p>
              <a className="btn" href={paths.nuevo}>Crear mi primer personaje <span aria-hidden="true">→</span></a>
              <p className="label" style={{ marginTop: '1.25rem' }}>Tarda menos de un minuto</p>
            </div>
          ) : (
            <>
              <div className="list-meta">
                <span className="label">{count} de {MAX_CHARACTERS} personajes</span>
                <span className="label">Elige uno para verlo</span>
              </div>
              <ul className="character-list">
                {save.characters.map((character) => {
                  const selected = character.id === save.activeId
                  return (
                    <li key={character.id} className={`character-row${selected ? ' is-selected' : ''}`}>
                      <Thumb spec={character.spec} stored={character.thumb} name={character.name} />
                      <div className="character-info">
                        <h2>{character.name}</h2>
                        {selected && <span className="tag"><span aria-hidden="true">✓</span> Protagonista</span>}
                        <p>{outfit(character)}</p>
                      </div>
                      <div className="character-actions">
                        {!selected && (
                          <button type="button" className="btn btn-small" onClick={() => selectCharacter(character.id)} aria-label={`Elegir a ${character.name} como protagonista`}>Elegir</button>
                        )}
                        <a className="btn btn-ghost btn-small" href={paths.editar(character.id)} aria-label={`Editar a ${character.name}`}>Editar</a>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => setToDelete(character)} aria-label={`Eliminar a ${character.name}`}>Eliminar</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {!full ? (
                <button type="button" className="add-row" onClick={() => navigate(paths.nuevo)}>
                  <span className="plus" aria-hidden="true">＋</span> Crear otro personaje
                </button>
              ) : (
                <p className="limit-note">Has llegado al límite de {MAX_CHARACTERS} personajes. Elimina uno para crear otro.</p>
              )}
            </>
          )}
        </section>

        <aside className="layout-side side-sticky" aria-label="Protagonista actual">
          <AvatarView
            spec={previewSpec}
            label={activeCharacter ? `Vista 3D de ${activeCharacter.name}` : 'Vista 3D de ejemplo'}
            tag={activeCharacter ? 'Protagonista actual' : 'Así verás a tu personaje'}
          />
          {activeCharacter && (
            <div className="card selected-card">
              <div>
                <p className="label">Seleccionado</p>
                <h2>{activeCharacter.name}</h2>
              </div>
              <a className="btn" href={paths.dificultad}>Siguiente: dificultad <span aria-hidden="true">→</span></a>
            </div>
          )}
        </aside>
      </div>

      {toDelete && (
        <Dialog
          title={`¿Eliminar a ${toDelete.name}?`}
          onClose={() => setToDelete(null)}
          actions={
            <>
              <button type="button" className="btn btn-ghost" data-autofocus onClick={() => setToDelete(null)}>No, volver</button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete}>Sí, eliminar</button>
            </>
          }
        >
          <p>Se borrará de este dispositivo junto con su aspecto. No se puede deshacer.</p>
        </Dialog>
      )}
    </Page>
  )
}
