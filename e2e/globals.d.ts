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

interface Window {
  __avatarStudio?: () => {
    stats(): StudioStats
    setAvatar(spec: Record<string, unknown>, catalog: unknown): Promise<void>
  }
  __renderThumbnail?: (spec: Record<string, unknown>, catalog: unknown) => Promise<string>
}
