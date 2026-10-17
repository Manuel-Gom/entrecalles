export const SLOTS = ['pelo', 'torso', 'piernas', 'conjunto', 'calzado', 'cabeza', 'gafas', 'barba'] as const
export type Slot = (typeof SLOTS)[number]
export type Genero = 'hombre' | 'mujer'
export const TINT_SLOTS = ['torso', 'piernas', 'conjunto', 'calzado', 'cabeza'] as const
export type TintSlot = (typeof TINT_SLOTS)[number]

export interface CatalogPiece {
  id: string
  slot: Slot
  nombre: string
  /** huecos que oculta esta pieza (p. ej. una gorra oculta el pelo) */
  oculta?: Slot[]
  /** para qué cuerpos existe (ausente = todos) */
  para?: Genero[]
  /** se puede teñir con un color de tela (telas lisas) */
  tinte?: boolean
  /** color con el que se ve la pieza si no se elige otro (las telas teñibles vienen en gris claro) */
  colorDefecto?: string
  miniatura?: boolean
}

export interface CatalogBody {
  id: string
  nombre: string
  descripcion: string
  genero?: Genero
  defecto: Partial<Record<Slot, string>>
  /** color de pelo por defecto del cuerpo (ausente = el de la textura) */
  colorPelo?: string
  miniatura?: boolean
}

export interface Catalog {
  cuerpos: CatalogBody[]
  huecos: Record<Slot, string>
  piezas: CatalogPiece[]
}

/** Lo que se guarda de cada personaje: ids del catálogo, nunca modelos. En cada hueco:
 * id de la pieza, null = ninguna, ausente = la que trae el cuerpo por defecto. */
export interface AvatarSpec {
  cuerpo: string
  colorPelo?: string | null
  pelo?: string | null
  torso?: string | null
  piernas?: string | null
  conjunto?: string | null
  calzado?: string | null
  cabeza?: string | null
  gafas?: string | null
  barba?: string | null
  /** color de tela de las piezas teñibles (por hueco) */
  colores?: Partial<Record<TintSlot, string>>
}

export const HAIR_COLORS = [
  { value: '#1b1612', label: 'Negro' },
  { value: '#4a2f1f', label: 'Castaño' },
  { value: '#a67c3d', label: 'Rubio oscuro' },
  { value: '#d2b26a', label: 'Rubio' },
  { value: '#9b3d1f', label: 'Pelirrojo' },
  { value: '#9a9a9a', label: 'Gris' },
  { value: '#e0e0e0', label: 'Blanco' },
] as const

export const CLOTH_COLORS = [
  { value: '#f4f4f0', label: 'Blanco' },
  { value: '#202225', label: 'Negro' },
  { value: '#8d9296', label: 'Gris' },
  { value: '#1f3a5f', label: 'Azul marino' },
  { value: '#3f7fbf', label: 'Azul' },
  { value: '#2f9e9e', label: 'Turquesa' },
  { value: '#3f7d52', label: 'Verde' },
  { value: '#d6a52f', label: 'Mostaza' },
  { value: '#cdb694', label: 'Beige' },
  { value: '#b53a35', label: 'Rojo' },
  { value: '#d98aa4', label: 'Rosa' },
  { value: '#7b5ea7', label: 'Morado' },
] as const

const base = `${import.meta.env.BASE_URL}models/modular/`

let catalogPromise: Promise<Catalog> | null = null

export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= fetch(`${base}manifest.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`No se pudo leer el catálogo (${response.status})`)
      return response.json() as Promise<Catalog>
    })
    .catch((error) => {
      catalogPromise = null
      throw error
    })
  return catalogPromise
}

export const bodyUrl = (cuerpo: string) => `${base}${cuerpo}/body.glb`
export const pieceUrl = (cuerpo: string, slot: Slot, id: string) => `${base}${cuerpo}/${slot}/${id}.glb`
export const bodyThumbUrl = (cuerpo: string) => `${base}miniaturas/cuerpos/${cuerpo}.png`
export const pieceThumbUrl = (slot: Slot, id: string) => `${base}miniaturas/${slot}/${id}.png`

export const genderOf = (body: CatalogBody | undefined): Genero => body?.genero ?? 'hombre'

/** Piezas de un hueco que existen para ese cuerpo. */
export function piecesFor(catalog: Catalog, body: CatalogBody | undefined, slot: Slot): CatalogPiece[] {
  const genero = genderOf(body)
  return catalog.piezas.filter((piece) => piece.slot === slot && (piece.para ?? ['hombre', 'mujer']).includes(genero))
}

/** ¿Se puede dejar este hueco vacío? El calzado y las piernas siempre se llevan; sin ropa interior,
 * los cuerpos femeninos tampoco pueden quedarse sin camiseta. */
export function isOptional(slot: Slot, body: CatalogBody | undefined): boolean {
  if (slot === 'calzado' || slot === 'piernas') return false
  if (slot === 'torso') return genderOf(body) !== 'mujer'
  return true
}

/** Completa y corrige un aspecto: ids que no existen, huecos incompatibles y piezas obligatorias. */
export function normalizeSpec(spec: Partial<AvatarSpec> | undefined, catalog: Catalog): AvatarSpec {
  const body = catalog.cuerpos.find((item) => item.id === spec?.cuerpo) ?? catalog.cuerpos[0]
  const available = (slot: Slot) => piecesFor(catalog, body, slot)
  const exists = (slot: Slot, id: string | null | undefined) =>
    id && available(slot).some((piece) => piece.id === id) ? id : null
  const first = (slot: Slot) => available(slot)[0]?.id ?? null
  /** null = el usuario eligió "ninguno"; sin dato = el valor por defecto del cuerpo */
  const wanted = (slot: Slot) => {
    const value = spec?.[slot]
    if (value === null) return null
    return exists(slot, value ?? body.defecto[slot])
  }
  const required = (slot: Slot) => wanted(slot) ?? exists(slot, body.defecto[slot]) ?? first(slot)

  const conjunto = wanted('conjunto')
  const requestedColor = spec?.colorPelo === undefined ? body.colorPelo : spec.colorPelo
  const hairColor = HAIR_COLORS.some((color) => color.value === requestedColor) ? (requestedColor ?? null) : null

  const result: AvatarSpec = {
    cuerpo: body.id,
    pelo: wanted('pelo'),
    conjunto,
    calzado: required('calzado'),
    // un conjunto ya incluye camiseta y pantalón
    torso: conjunto ? null : isOptional('torso', body) ? wanted('torso') : required('torso'),
    piernas: conjunto ? null : required('piernas'),
    cabeza: wanted('cabeza'),
    gafas: wanted('gafas'),
    barba: wanted('barba'),
    colorPelo: hairColor,
  }

  // solo se conservan los colores de piezas teñibles y de la paleta
  const colors: Partial<Record<TintSlot, string>> = {}
  for (const slot of TINT_SLOTS) {
    const color = spec?.colores?.[slot]
    const piece = catalog.piezas.find((item) => item.slot === slot && item.id === result[slot])
    if (color && piece?.tinte && CLOTH_COLORS.some((option) => option.value === color)) colors[slot] = color
  }
  if (Object.keys(colors).length > 0) result.colores = colors
  return result
}

/** Pieza que se muestra en cada hueco, aplicando las ocultaciones (una gorra oculta el pelo). */
export function visiblePieces(spec: AvatarSpec, catalog: Catalog): Partial<Record<Slot, string>> {
  const result: Partial<Record<Slot, string>> = {}
  for (const slot of SLOTS) {
    const id = spec[slot]
    if (id) result[slot] = id
  }
  for (const slot of SLOTS) {
    const id = spec[slot]
    const piece = catalog.piezas.find((item) => item.slot === slot && item.id === id)
    for (const hidden of piece?.oculta ?? []) delete result[hidden]
  }
  return result
}

/** Resumen de la ropa elegida, para tarjetas y listas. */
export function describeSpec(spec: AvatarSpec, catalog: Catalog): string {
  const normalized = normalizeSpec(spec, catalog)
  return (['conjunto', 'torso', 'piernas', 'calzado'] as const)
    .map((slot) => catalog.piezas.find((piece) => piece.slot === slot && piece.id === normalized[slot])?.nombre)
    .filter(Boolean)
    .join(' · ')
}

/** Color de tela que se aplica a la pieza de un hueco: el elegido, o el original de la prenda (si es teñible). */
export function tintFor(spec: AvatarSpec, catalog: Catalog, slot: TintSlot): string | null {
  const piece = catalog.piezas.find((item) => item.slot === slot && item.id === spec[slot])
  if (!piece?.tinte) return null
  return spec.colores?.[slot] ?? piece.colorDefecto ?? null
}
