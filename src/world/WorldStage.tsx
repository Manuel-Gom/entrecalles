import { useEffect, useRef } from 'react'
import type { AvatarSpec, Catalog } from '../avatar/catalog'
import type { Npc } from '../avatar/npcs'
import type { Volumes } from './audio'
import type { Controls, Quality, World, WorldStatus } from './world'

interface WorldStageProps {
  spec: AvatarSpec
  catalog: Catalog
  npcs: Npc[]
  controls: Controls
  reducedMotion: boolean
  quality: Quality
  paused: boolean
  onStatus: (status: WorldStatus) => void
  /** el barrio no se pudo crear (por ejemplo, falló la descarga del código 3D) */
  onFail: () => void
  /** el mando pidió pausar o reanudar */
  onPause: () => void
  volumes: Volumes
  subtitles: boolean
}

/** Monta el barrio 3D dentro de un contenedor y lo libera al desmontarse. */
export default function WorldStage({ spec, catalog, npcs, controls, reducedMotion, quality, paused, onStatus, onFail, onPause, volumes, subtitles }: WorldStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<World | null>(null)
  // el resto de valores iniciales se leen una vez; la calidad y la pausa pueden cambiar mientras se descarga el código 3D
  const initial = useRef({ spec, catalog, npcs, controls, reducedMotion, onStatus, onFail, onPause, volumes, subtitles })
  const latest = useRef({ quality, paused })
  latest.current = { quality, paused }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void import('./world')
      .then(({ World }) => {
        if (cancelled) return
        const { onStatus: statusListener, onFail: _onFail, ...init } = initial.current
        const world = new World({ host, ...init, quality: latest.current.quality })
        worldRef.current = world
        window.__world = () => world
        unsubscribe = world.subscribe(statusListener)
        world.setPaused(latest.current.paused)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('No se pudo crear el barrio.', error)
        initial.current.onFail()
      })
    return () => {
      cancelled = true
      unsubscribe?.()
      const world = worldRef.current
      if (world) {
        world.dispose()
        if (window.__world?.() === world) window.__world = undefined
      }
      worldRef.current = null
    }
  }, [])

  useEffect(() => {
    worldRef.current?.setQuality(quality)
  }, [quality])

  useEffect(() => {
    worldRef.current?.setPaused(paused)
  }, [paused])

  return <div ref={hostRef} className="world-canvas" />
}
