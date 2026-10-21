import { SLOTS, TINT_SLOTS, type AvatarSpec, type TintSlot } from '../avatar/catalog'

export type Difficulty = 'relajada' | 'equilibrada' | 'intensa'

export interface Character {
  id: string
  name: string
  spec: AvatarSpec
  /** retrato pequeño (data URL) generado al guardar */
  thumb?: string
}

export interface GameSettings {
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  controlPreset: 'clasico' | 'flechas'
  subtitles: boolean
  highContrast: boolean
  reducedMotion: boolean
  largeText: boolean
}

export interface SaveData {
  version: 2
  characters: Character[]
  activeId: string | null
  difficulty: Difficulty
  settings: GameSettings
}

export const STORAGE_KEY = 'entrecalles-save-v2'
const LEGACY_STORAGE_KEY = 'entrecalles-save-v1'
export const MAX_CHARACTERS = 8
export const NAME_MAX = 24

export const DIFFICULTIES: Record<Difficulty, {
  title: string
  tagline: string
  detail: string
  level: 1 | 2 | 3
  effects: [string, string][]
}> = {
  relajada: {
    title: 'A tu ritmo',
    tagline: 'Poca presión',
    detail: 'Más margen para explorar y recuperarte. Pensada para disfrutar la historia sin presión.',
    level: 1,
    effects: [
      ['Daño recibido', 'Bajo'],
      ['Ayudas en pantalla', 'Abundantes'],
      ['Recursos en la ciudad', 'Generosos'],
      ['Consecuencias de tus decisiones', 'Leves'],
    ],
  },
  equilibrada: {
    title: 'En la calle',
    tagline: 'Recomendada',
    detail: 'Un reto equilibrado entre exploración, decisiones y consecuencias.',
    level: 2,
    effects: [
      ['Daño recibido', 'Normal'],
      ['Ayudas en pantalla', 'Moderadas'],
      ['Recursos en la ciudad', 'Equilibrados'],
      ['Consecuencias de tus decisiones', 'Notables'],
    ],
  },
  intensa: {
    title: 'Sin red',
    tagline: 'Reto alto',
    detail: 'Menos ayudas y consecuencias más duras. Para quien busca un reto.',
    level: 3,
    effects: [
      ['Daño recibido', 'Alto'],
      ['Ayudas en pantalla', 'Mínimas'],
      ['Recursos en la ciudad', 'Escasos'],
      ['Consecuencias de tus decisiones', 'Duras'],
    ],
  },
}

export const defaultSettings = (): GameSettings => ({
  masterVolume: 80,
  musicVolume: 65,
  effectsVolume: 80,
  controlPreset: 'clasico',
  subtitles: true,
  highContrast: false,
  reducedMotion: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  largeText: false,
})

export const emptySave = (): SaveData => ({
  version: 2,
  characters: [],
  activeId: null,
  difficulty: 'equilibrada',
  settings: defaultSettings(),
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function parseSpec(raw: Record<string, unknown>): AvatarSpec | null {
  // v2 guarda "spec"; v1 guardaba "model" (el id de un personaje completo)
  const source = isRecord(raw.spec) ? raw.spec : { cuerpo: raw.model }
  if (typeof source.cuerpo !== 'string') return null
  const spec: AvatarSpec = { cuerpo: source.cuerpo }
  for (const slot of [...SLOTS, 'colorPelo'] as const) {
    const value = source[slot]
    if (typeof value === 'string' || value === null) spec[slot] = value
  }
  if (isRecord(source.colores)) {
    const colors: Partial<Record<TintSlot, string>> = {}
    for (const slot of TINT_SLOTS) {
      const color = source.colores[slot]
      if (typeof color === 'string') colors[slot] = color
    }
    if (Object.keys(colors).length > 0) spec.colores = colors
  }
  return spec
}

function parseCharacters(value: unknown): Character[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Character[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || seen.has(item.id)) continue
    const spec = parseSpec(item)
    if (!spec) continue
    seen.add(item.id)
    const character: Character = { id: item.id, name: item.name.slice(0, NAME_MAX), spec }
    if (typeof item.thumb === 'string' && item.thumb.startsWith('data:image/')) character.thumb = item.thumb
    result.push(character)
    if (result.length >= MAX_CHARACTERS) break
  }
  return result
}

const clamp = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback

function parseSettings(value: unknown): GameSettings {
  const base = defaultSettings()
  if (!isRecord(value)) return base
  const bool = (key: keyof GameSettings, fallback: boolean) => (typeof value[key] === 'boolean' ? (value[key] as boolean) : fallback)
  return {
    masterVolume: clamp(value.masterVolume, base.masterVolume),
    musicVolume: clamp(value.musicVolume, base.musicVolume),
    effectsVolume: clamp(value.effectsVolume, base.effectsVolume),
    // v1 guardaba "clásico" y "zurdo"
    controlPreset: value.controlPreset === 'flechas' || value.controlPreset === 'zurdo' ? 'flechas' : 'clasico',
    subtitles: bool('subtitles', base.subtitles),
    highContrast: bool('highContrast', base.highContrast),
    reducedMotion: bool('reducedMotion', base.reducedMotion),
    largeText: bool('largeText', base.largeText),
  }
}

/** Lee y valida lo guardado; migra el formato v1. Nunca lanza: ante datos dañados empieza de cero. */
export function readSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return emptySave()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return emptySave()
    const characters = parseCharacters(parsed.characters)
    const difficulty = typeof parsed.difficulty === 'string' && Object.hasOwn(DIFFICULTIES, parsed.difficulty) ? (parsed.difficulty as Difficulty) : 'equilibrada'
    return {
      version: 2,
      characters,
      activeId: typeof parsed.activeId === 'string' && characters.some((c) => c.id === parsed.activeId) ? parsed.activeId : null,
      difficulty,
      settings: parseSettings(parsed.settings),
    }
  } catch {
    return emptySave()
  }
}

/** Devuelve true si se pudo guardar. */
export function writeSave(save: SaveData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save))
    return true
  } catch {
    return false
  }
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
