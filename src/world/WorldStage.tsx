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
  /** el mando pidió pausar o reanudar */
  onPause: () => void
  volumes: Volumes
  subtitles: boolean
}

/** Monta el barrio 3D dentro de un contenedor y lo libera al desmontarse. */
export default function WorldStage({ spec, catalog, npcs, controls, reducedMotion, quality, paused, onStatus, onPause, volumes, subtitles }: WorldStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<World | null>(null)
  // los valores iniciales se leen una vez; los cambios posteriores (calidad, pausa) tienen su propio efecto
  const initial = useRef({ spec, catalog, npcs, controls, reducedMotion, quality, paused, onStatus, onPause, volumes, subtitles })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void import('./world').then(({ World }) => {
      if (cancelled) return
      const first = initial.current
      const { paused: _paused, onStatus: _onStatus, ...init } = first
      const world = new World({ host, ...init })
      worldRef.current = world
      window.__world = () => world
      unsubscribe = world.subscribe(first.onStatus)
      world.setPaused(first.paused)
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
