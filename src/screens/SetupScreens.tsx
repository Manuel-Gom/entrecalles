import { useEffect } from 'react'
import { AvatarView } from '../components/AvatarView'
import { RangeField, Segmented, Switch, useRadioKeys } from '../components/Controls'
import { Page } from '../components/Layout'
import { Thumb } from '../components/Thumb'
import { navigate, paths } from '../router'
import { DIFFICULTIES, type Difficulty } from '../state/save'
import { useSave } from '../state/SaveProvider'
import { useToast } from '../state/ToastProvider'

/** Los pasos de la preparación necesitan un personaje elegido. */
function useRequireCharacter() {
  const { activeCharacter } = useSave()
  const notify = useToast()
  useEffect(() => {
    if (!activeCharacter) {
      notify('Elige o crea un personaje para continuar.')
      navigate(paths.personajes)
    }
  }, [activeCharacter, notify])
  return activeCharacter
}

/* ---------------- dificultad ---------------- */
const ORDER: Difficulty[] = ['relajada', 'equilibrada', 'intensa']

export function DifficultyScreen() {
  const character = useRequireCharacter()
  const { save, setDifficulty } = useSave()
  const index = ORDER.indexOf(save.difficulty)
  const { refs, onKeyDown } = useRadioKeys(ORDER.length, index, (next) => setDifficulty(ORDER[next]))
  const chosen = DIFFICULTIES[save.difficulty]
  if (!character) return null

  return (
    <Page
      plainTitle="Dificultad"
      title={<>Elige cómo <span className="accent">se vive.</span></>}
      lead="Puedes cambiarla antes de empezar. Esto es el equilibrio previsto: el juego aún no aplica estos efectos."
      back={{ label: 'Volver a personajes', href: paths.personajes }}
    >
      <div className="layout-two">
        <div className="layout-main options" role="radiogroup" aria-label="Dificultad" onKeyDown={onKeyDown}>
          {ORDER.map((id, position) => {
            const item = DIFFICULTIES[id]
            return (
              <button
                type="button"
                role="radio"
                key={id}
                ref={(element) => { refs.current[position] = element }}
                aria-checked={id === save.difficulty}
                tabIndex={id === save.difficulty ? 0 : -1}
                className="option-card"
                onClick={() => setDifficulty(id)}
              >
                <span className="radio-dot" aria-hidden="true" />
                <span className="option-body">
                  <span className="option-head">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                      <span className="display" style={{ font: '700 1.625rem var(--font-display)' }}>{item.title}</span>
                      {id === 'equilibrada' && <span className="tag">Recomendada</span>}
                    </span>
                    <span className="meter" role="img" aria-label={`Intensidad ${item.level} de 3`}>
                      {[1, 2, 3].map((level) => <i key={level} className={level <= item.level ? 'on' : ''} />)}
                    </span>
                  </span>
                  <span style={{ display: 'block', color: 'var(--soft)', marginTop: '.375rem' }}>{item.detail}</span>
                </span>
              </button>
            )
          })}
        </div>

        <aside className="layout-side card panel-pad" aria-labelledby="efectos">
          <h2 id="efectos" className="label accent">Efectos previstos · {chosen.title}</h2>
          <table className="effects">
            <caption className="sr-only">Efectos previstos de la dificultad {chosen.title}</caption>
            <tbody>
              {chosen.effects.map(([name, value]) => (
                <tr key={name}><th scope="row">{name}</th><td>{value}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="note" style={{ marginTop: '1.25rem' }}>
            <span aria-hidden="true">ⓘ</span>
            <span>Estos efectos son una previsión. Aún no hay sistemas de juego: solo se guarda tu elección.</span>
          </div>
          <div className="actions" style={{ marginTop: '1.75rem' }}>
            <a className="btn" href={paths.ajustes}>Siguiente: ajustes <span aria-hidden="true">→</span></a>
            <a className="btn btn-ghost" href={paths.personajes}>Atrás</a>
          </div>
        </aside>
      </div>
    </Page>
  )
}

/* ---------------- ajustes ---------------- */
export function SettingsScreen() {
  const character = useRequireCharacter()
  const { save, updateSettings } = useSave()
  const { settings } = save
  if (!character) return null
  const arrows = settings.controlPreset === 'flechas'

  return (
    <Page
      plainTitle="Ajustes"
      title={<>Hazlo a <span className="accent">tu manera.</span></>}
      lead="Estos ajustes se guardan en este dispositivo y se aplican al instante."
      back={{ label: 'Volver a dificultad', href: paths.dificultad }}
    >
      <div className="settings">
        <div className="settings-col">
          <section className="card" aria-labelledby="audio">
            <h2 id="audio">Audio</h2>
            <RangeField label="Volumen general" value={settings.masterVolume} onChange={(value) => updateSettings('masterVolume', value)} />
            <RangeField label="Música" value={settings.musicVolume} onChange={(value) => updateSettings('musicVolume', value)} />
            <RangeField label="Efectos" value={settings.effectsVolume} onChange={(value) => updateSettings('effectsVolume', value)} />
          </section>

          <section className="card" aria-labelledby="controles">
            <h2 id="controles">Controles</h2>
            <Segmented
              label="Distribución de teclado"
              value={settings.controlPreset}
              options={[{ value: 'clasico', label: 'Clásica · WASD' }, { value: 'flechas', label: 'Flechas' }]}
              onChange={(value) => updateSettings('controlPreset', value)}
            />
            <div className="keys">
              <div className="keycap-grid" aria-hidden="true">
                {arrows ? (
                  <><span /><kbd>↑</kbd><span /><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></>
                ) : (
                  <><span /><kbd>W</kbd><span /><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></>
                )}
              </div>
              <p style={{ flex: '1 1 14rem', color: 'var(--soft)' }}>
                Moverse con <strong>{arrows ? 'las flechas' : 'W A S D'}</strong>, interactuar con <strong>{arrows ? 'Intro' : 'E'}</strong>, correr con <strong>Mayús</strong>.
              </p>
            </div>
            <div className="note" style={{ marginTop: '1.25rem' }}>
              <span aria-hidden="true">ⓘ</span>
              <span>Por ahora solo se guarda la distribución. Reasignar teclas llegará con el juego.</span>
            </div>
          </section>
        </div>

        <section className="card settings-col narrow" aria-labelledby="accesibilidad">
          <h2 id="accesibilidad">Accesibilidad</h2>
          <Switch title="Subtítulos" description="Mostrar los diálogos como texto." checked={settings.subtitles} onChange={(value) => updateSettings('subtitles', value)} />
          <Switch title="Alto contraste" description="Más contraste en toda la interfaz." checked={settings.highContrast} onChange={(value) => updateSettings('highContrast', value)} />
          <Switch title="Reducir movimiento" description="Sin giro automático ni animaciones." checked={settings.reducedMotion} onChange={(value) => updateSettings('reducedMotion', value)} />
          <Switch title="Texto grande" description="Aumenta el tamaño del texto un 25 %." checked={settings.largeText} onChange={(value) => updateSettings('largeText', value)} />
          <div className="actions" style={{ marginTop: '1.5rem' }}>
            <a className="btn" href={paths.resumen}>Revisar partida <span aria-hidden="true">→</span></a>
            <a className="btn btn-ghost" href={paths.dificultad}>Atrás</a>
          </div>
        </section>
      </div>
    </Page>
  )
}

/* ---------------- resumen ---------------- */
export function SummaryScreen() {
  const character = useRequireCharacter()
  const { save } = useSave()
  const notify = useToast()
  if (!character) return null
  const { settings } = save
  const accessibility = [settings.subtitles && 'Subtítulos', settings.highContrast && 'Alto contraste', settings.reducedMotion && 'Movimiento reducido', settings.largeText && 'Texto grande'].filter(Boolean).join(' · ')

  return (
    <Page
      plainTitle="Resumen"
      title={<>Todo listo <span className="accent">para salir.</span></>}
      lead="Revisa tu preparación antes de comenzar."
      back={{ label: 'Volver a ajustes', href: paths.ajustes }}
    >
      <div className="layout-two">
        <section className="card summary-card layout-main" aria-label="Resumen de la partida">
          <div className="summary-person">
            <Thumb spec={character.spec} stored={character.thumb} name={character.name} />
            <div>
              <p className="label">Protagonista</p>
              <h2>{character.name}</h2>
            </div>
            <a className="link" href={paths.personajes}>Cambiar</a>
          </div>
          <div className="summary-row">
            <span className="label">Dificultad</span>
            <strong>{DIFFICULTIES[save.difficulty].title}</strong>
            <a className="link" href={paths.dificultad}>Cambiar</a>
          </div>
          <div className="summary-row">
            <span className="label">Controles</span>
            <strong>{settings.controlPreset === 'flechas' ? 'Flechas' : 'Clásica · WASD'}</strong>
            <a className="link" href={paths.ajustes}>Ajustar</a>
          </div>
          <div className="summary-row">
            <span className="label">Audio</span>
            <strong>General {settings.masterVolume} % · Música {settings.musicVolume} % · Efectos {settings.effectsVolume} %</strong>
            <a className="link" href={paths.ajustes}>Ajustar</a>
          </div>
          <div className="summary-row">
            <span className="label">Accesibilidad</span>
            <strong>{accessibility || 'Valores por defecto'}</strong>
            <a className="link" href={paths.ajustes}>Ajustar</a>
          </div>
          <div className="summary-cta">
            <div className="actions">
              <button type="button" className="btn btn-large" onClick={() => notify('Tu preparación está guardada. La aventura estará disponible cuando el juego esté listo.')}>
                Comenzar aventura <span aria-hidden="true">→</span>
              </button>
              <a className="btn btn-ghost" href={paths.ajustes}>Atrás</a>
            </div>
            <div className="note" style={{ marginTop: '1.25rem' }}>
              <span aria-hidden="true">ⓘ</span>
              <span>Esta versión incluye el menú y la preparación. El mundo jugable aún no está disponible; tu elección queda guardada.</span>
            </div>
          </div>
        </section>

        <aside className="layout-side summary-stage" aria-label="Tu protagonista">
          <AvatarView spec={character.spec} label={`Vista 3D de ${character.name}`} tag={`${character.name} · ${DIFFICULTIES[save.difficulty].title}`} />
        </aside>
      </div>
    </Page>
  )
}
