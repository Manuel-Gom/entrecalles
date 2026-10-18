/** Enganches de prueba que expone la aplicación (ver src/avatar/studio.ts y thumbnail.ts). */
interface StudioStats {
  model: string | null
  pieces: string
  tints: Record<string, string>
  state: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'
  geometries: number
  textures: number
  calls: number
  triangles: number
}

/** Lo que usan las pruebas del barrio (ver src/world/world.ts). */
interface WorldHandle {
  stats(): {
    state: 'cargando' | 'listo' | 'error' | 'sin-3d'
    time: number
    quality: 'baja' | 'media' | 'alta'
    player: { x: number; z: number; yaw: number; speed: number; animation: 'quieto' | 'anda' | 'corre'; seated: boolean }
    device: 'teclado' | 'mando'
    gamepad: { kind: 'playstation' | 'xbox' | 'otro'; name: string; id: string; standard: boolean } | null
    prompt: 'sentarse' | 'levantarse' | null
    cameraYaw: number
    mode: 'calle' | 'interior'
    transitioning: boolean
    scenery: { benches: boolean; storefront: boolean }
    door: { openness: number; x: number; z: number } | null
    npcs: {
      total: number
      loaded: number
      sitting: number
      activities: Record<string, number>
      list: { id: string; name: string; activity: string; x: number; z: number; speed: number; sit: number; completed: number; doing: boolean }[]
    }
    geometries: number
    textures: number
    calls: number
    triangles: number
  }
  layout: { benches: { x: number; z: number; yaw: number }[]; buildings: { box: { minX: number; maxX: number; minZ: number; maxZ: number } }[]; obstacles: { minX: number; maxX: number; minZ: number; maxZ: number }[] }
  advance(seconds: number): void
  teleport(x: number, z: number, yaw?: number): void
  interact(): void
  diagnosticsText(): string
  resetDiagnostics(): void
  setQuality(quality: 'baja' | 'media' | 'alta'): void
  performance(): { frames: number; fps: number; avgMs: number; p99Ms: number; worstMs: number; quality: string; width: number; height: number; pixelRatio: number; triangles: number; calls: number; npcs: number; gpu: string | null }
  orbitCamera(yaw: number, pitch: number, distance: number): void
  inputOverride: { moveX: number; moveZ: number; run: boolean } | null
  setPaused(paused: boolean): void
}

interface Window {
  __avatarStudio?: () => {
    stats(): StudioStats
    setAvatar(spec: Record<string, unknown>, catalog: unknown): Promise<void>
  }
  __world?: () => WorldHandle | null
  __WORLD_NPC_LIMIT__?: number
  __renderThumbnail?: (spec: Record<string, unknown>, catalog: unknown) => Promise<string>
}
