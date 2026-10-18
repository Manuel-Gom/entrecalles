import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { loadNpcs, type Npc } from '../avatar/npcs'
import { navigate, paths } from '../router'
import { useCatalog } from '../state/CatalogProvider'
import { useSave } from '../state/SaveProvider'
import { useToast } from '../state/ToastProvider'
import { padLabels } from '../world/input'
import type { Quality, WorldStatus } from '../world/world'

const WorldStage = lazy(() => import('../world/WorldStage'))

const QUALITY_KEY = 'entrecalles-calidad'
const QUALITIES: { value: Quality; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
]

function readQuality(): Quality {
  try {
    const stored = localStorage.getItem(QUALITY_KEY)
    if (stored === 'baja' || stored === 'media' || stored === 'alta') return stored
  } catch {
    // sin almacenamiento: se usa la calidad por defecto
  }
  return 'media'
}

const PROMPT_TEXT = { sentarse: 'sentarte', levantarse: 'levantarte', entrar: 'entrar al café', salir: 'salir a la calle' } as const

const messages: Partial<Record<WorldStatus['state'], string>> = {
  cargando: 'Cargando el barrio…',
  error: 'No se pudo cargar tu personaje. Vuelve al menú e inténtalo de nuevo.',
  'sin-3d': 'La vista 3D no está disponible en este navegador.',
}

/** El barrio jugable: pantalla completa, sin la barra del menú. */
export function WorldScreen() {
  const { activeCharacter, save } = useSave()
  const { catalog } = useCatalog()
  const notify = useToast()
  const [npcs, setNpcs] = useState<Npc[] | null>(null)
  const [status, setStatus] = useState<WorldStatus>({ state: 'cargando', npcsLoaded: 0, npcsTotal: 0, fps: 0, device: 'teclado', gamepad: null, prompt: null, subtitle: null, audio: 'none', diagnostics: '' })
  const [quality, setQuality] = useState<Quality>(readQuality)
  const [paused, setPaused] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!activeCharacter) {
      notify('Elige o crea un personaje para salir a la calle.')
      navigate(paths.personajes)
    }
  }, [activeCharacter, notify])

  useEffect(() => {
    document.title = 'Barrio · Entrecalles'
    let cancelled = false
    // si la lista de PNJ no se puede leer, se juega igualmente con la calle vacía
    loadNpcs().then((list) => !cancelled && setNpcs(list)).catch(() => !cancelled && setNpcs([]))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPaused((value) => !value)
      else if (event.key === 'F3') {
        event.preventDefault()
        setShowDiagnostics((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chooseQuality = (value: Quality) => {
    setQuality(value)
    try {
      localStorage.setItem(QUALITY_KEY, value)
    } catch {
      // la preferencia solo se pierde al cerrar
    }
  }

  const onStatus = useCallback((next: WorldStatus) => setStatus(next), [])
  const togglePause = useCallback(() => setPaused((value) => !value), [])

  const copyDiagnostics = () => {
    void navigator.clipboard?.writeText(status.diagnostics).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!activeCharacter) return null
  const arrows = save.settings.controlPreset === 'flechas'
  const message = messages[status.state]
  const settings = save.settings
  const pad = status.gamepad
  const usingPad = status.device === 'mando' && pad !== null
  const labels = padLabels(pad?.kind ?? 'otro')

  return (
    <div className={`world${settings.highContrast ? ' high-contrast' : ''}`}>
      <h1 className="sr-only">Explorando el barrio con {activeCharacter.name}</h1>
      <div
        className="world-view"
        role="application"
        aria-label={`Barrio de Entrecalles. Controla a ${activeCharacter.name}: ${arrows ? 'flechas' : 'W, A, S y D'} o la palanca izquierda de un mando para moverte, Mayús o el gatillo derecho para correr, el ratón o la palanca derecha para girar la cámara y Escape o el botón de menú para pausar.`}
      >
        {catalog && npcs && (
          <Suspense fallback={null}>
            <WorldStage
              spec={activeCharacter.spec}
              catalog={catalog}
              npcs={npcs}
              controls={settings.controlPreset}
              reducedMotion={settings.reducedMotion}
              quality={quality}
              paused={paused}
              onStatus={onStatus}
              onPause={togglePause}
              volumes={{ master: settings.masterVolume, music: settings.musicVolume, effects: settings.effectsVolume }}
              subtitles={settings.subtitles}
            />
          </Suspense>
        )}
      </div>

      <header className="world-bar">
        <a className="logo" href={paths.inicio} aria-label="Entrecalles, inicio">
          <span className="logo-mark" aria-hidden="true">E</span>
        </a>
        <div className="world-chip">
          <span className="label">Protagonista</span>
          <strong>{activeCharacter.name}</strong>
        </div>
        {pad && (
          <div className="world-chip" role="status">
            <span className="label">Mando</span>
            <strong>{pad.name} conectado</strong>
          </div>
        )}
        <div className="world-actions">
          <label className="world-quality">
            <span>Calidad</span>
            <select value={quality} onChange={(event) => chooseQuality(event.target.value as Quality)}>
              {QUALITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="world-fps" aria-expanded={showDiagnostics} onClick={() => setShowDiagnostics((value) => !value)} title="Diagnóstico (F3)">
            {status.fps || '–'} FPS
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setPaused(true)}>Pausa</button>
        </div>
      </header>

      {showDiagnostics && (
        <section className="world-diagnostics" aria-label="Diagnóstico de rendimiento">
          <pre>{status.diagnostics}</pre>
          <div className="actions">
            <button type="button" className="btn btn-small" onClick={copyDiagnostics}>{copied ? 'Copiado' : 'Copiar'}</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowDiagnostics(false)}>Cerrar</button>
          </div>
        </section>
      )}

      <footer className="world-help" aria-hidden="true">
        {usingPad ? (
          <>
            <span>{labels.move} moverse</span>
            <span>{labels.run} correr</span>
            <span>{labels.camera} cámara</span>
            <span>{labels.pause} pausa</span>
          </>
        ) : (
          <>
            <span><kbd>{arrows ? '↑ ← ↓ →' : 'W A S D'}</kbd> moverse</span>
            <span><kbd>Mayús</kbd> correr</span>
            <span>Arrastra con el ratón para girar la cámara</span>
            <span><kbd>Esc</kbd> pausa</span>
          </>
        )}
      </footer>
      {status.subtitle && (
        <p className="world-subtitle" role="status" aria-live="polite">
          <strong>{status.subtitle.speaker}:</strong> {status.subtitle.text}
        </p>
      )}
      {status.audio === 'suspended' && (
        <p className="world-sound-hint" role="status">Pulsa una tecla o haz clic para activar el sonido</p>
      )}
      {status.prompt && (
        <p className="world-prompt" role="status">
          Pulsa <kbd>{usingPad ? labels.interact : arrows ? 'Intro' : 'E'}</kbd> para {PROMPT_TEXT[status.prompt]}
        </p>
      )}
      {pad && !pad.standard && (
        <p className="world-toast" role="status">Este mando no usa el mapeo estándar: puede que algunos botones no coincidan.</p>
      )}

      {status.state === 'listo' && status.npcsTotal > 0 && status.npcsLoaded < status.npcsTotal && (
        <p className="world-toast" role="status">Llegan vecinos al barrio: {status.npcsLoaded} de {status.npcsTotal}</p>
      )}
      {(message || !catalog || !npcs) && (
        <div className="world-overlay" role="status">
          <p>{message ?? 'Cargando el barrio…'}</p>
          {(status.state === 'error' || status.state === 'sin-3d') && (
            <a className="btn" href={paths.resumen}>Volver al menú</a>
          )}
        </div>
      )}

      {paused && (
        <div className="world-overlay" role="dialog" aria-modal="true" aria-labelledby="world-pause-title">
          <div className="world-pause">
            <h2 id="world-pause-title">Pausa</h2>
            <div className="actions">
              <button type="button" className="btn" autoFocus onClick={() => setPaused(false)}>Continuar</button>
              <a className="btn btn-ghost" href={paths.resumen}>Volver al menú</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
