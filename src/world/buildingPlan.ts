import type { Box, Vec2 } from './collision'
import type { Building, ShopKind, Spot } from './layout'

/**
 * El plano de cada edificio, sin Three.js: plantas, núcleo de escalera (y ascensor), portal y local en la planta baja,
 * pisos con sus estancias, azotea, huecos de puertas y ventanas y la colocación de los muebles. Es determinista: el
 * mismo edificio da siempre el mismo plano. Los muebles son modelos de Blender (tools/blender/crear_interiores.py)
 * cuyas medidas están en FURNITURE.
 *
 * Se trabaja en un marco propio de cada solar (u, v): el origen es la esquina de las dos fachadas, u avanza a lo largo
 * de la fachada del portal (la «fachada U», en v = 0) y v a lo largo de la del local (la «fachada V», en u = 0). Los
 * muros de enfrente (u = lu, v = lv) son medianeras con los solares vecinos: no llevan ventanas. Al final todo se pasa a
 * coordenadas del mundo.
 */

/* ---------- medidas (m) ---------- */

export const FLOOR_HEIGHT = 3
/** El suelo de la planta baja está a la altura de la acera (SIDEWALK_HEIGHT en layout.ts): se entra sin escalón. */
export const GROUND_FLOOR_Y = 0.05
export const SLAB = 0.2
/** Del suelo de una planta al techo (la cara de abajo del forjado de la siguiente). */
export const WALL_HEIGHT = FLOOR_HEIGHT - SLAB
/** Antepecho de la azotea. */
export const PARAPET = 0.6
export const EXTERIOR_WALL = 0.25
/** Muros del núcleo, del rellano y entre pisos; y tabiques. */
const CORE_WALL = 0.15
const PARTITION = 0.1
/** Escalera de ida y vuelta: dos tramos de 10 peldaños (9 huellas) y una meseta al fondo. */
export const STAIR_WIDTH = 2.6
export const STAIR_LANE = 1.2
export const STAIR_GAP = 0.2
export const RISER = 0.15
export const TREAD = 0.27
export const STAIR_RUN = 9 * TREAD
export const CORE_LENGTH = 3.7
/** Hueco del ascensor (interior) y desde cuántas plantas lo hay. */
const SHAFT_CLEAR = 1.4
const SHAFT_DEPTH = 1.5
export const ELEVATOR_MIN_FLOORS = 5
const ELEVATOR_GAP = 0.8
/** Fondo del rellano delante del núcleo. */
const LANDING = 1.5
export const PORTAL_OPENING = { width: 1.3, height: 2.6 }
export const SHOP_OPENING = { width: 3.4, height: 2.7 }
const ROOM_DOOR = { width: 0.82, height: 2.05 }
const FLAT_DOOR = { width: 0.92, height: 2.1 }
export const WINDOW = { width: 1.2, sill: 0.9, top: 2.3 }
/** Fondo del almacén al final del local, si el local es largo. */
const STORE_DEPTH = 2.8
/** Largo mínimo del local para tener almacén. */
const STORE_MIN_LENGTH = 11

export const levelY = (level: number) => GROUND_FLOOR_Y + level * FLOOR_HEIGHT
export const roofY = (floors: number) => levelY(floors)
export const buildingHeight = (floors: number) => roofY(floors) + PARAPET
export const hasElevator = (floors: number) => floors >= ELEVATOR_MIN_FLOORS
/** Ancho del núcleo (escalera, su muro y, si hay, el hueco del ascensor con el suyo). */
export const coreWidth = (floors: number) => STAIR_WIDTH + CORE_WALL + (hasElevator(floors) ? SHAFT_CLEAR + CORE_WALL : 0)
/** Ancho libre del portal: el del núcleo. */
const hallWidth = (floors: number) => coreWidth(floors) - CORE_WALL
/** v de la línea por la que se entra a la escalera (el núcleo va de ahí a la medianera del fondo). */
const entryLine = (lv: number) => lv - EXTERIOR_WALL - CORE_LENGTH

/* ---------- el marco del solar ---------- */

export interface LotFrame {
  /** esquina de las dos fachadas */
  ox: number
  oz: number
  /** direcciones (unitarias, sobre los ejes) de u y v hacia dentro del solar */
  ux: number
  uz: number
  vx: number
  vz: number
  /** largo de la fachada U (la del portal) y de la fachada V (la del local) */
  lu: number
  lv: number
}

export function toWorld(f: LotFrame, u: number, v: number): Vec2 {
  return { x: f.ox + u * f.ux + v * f.vx, z: f.oz + u * f.uz + v * f.vz }
}

export function dirToWorld(f: LotFrame, du: number, dv: number): Vec2 {
  return { x: du * f.ux + dv * f.vx, z: du * f.uz + dv * f.vz }
}

/** Giro (rad) con el que un modelo mira hacia `dir`: el frente de los modelos es +Z. */
export const yawOf = (dir: Vec2) => Math.atan2(dir.x, dir.z)

export function rectToBox(f: LotFrame, u0: number, v0: number, u1: number, v1: number): Box {
  const a = toWorld(f, u0, v0)
  const b = toWorld(f, u1, v1)
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }
}

/**
 * Marco de un solar en esquina. `streetX` y `streetZ` dicen hacia qué lado (−1 o 1) dan sus fachadas a la calle. El
 * portal va en la fachada más corta (así el fondo, donde caben los pisos, es el más largo), salvo que `portalOnXFace`
 * lo fuerce a la fachada que mira a lo largo de x (la del café está en la otra).
 */
export function lotFrame(box: Box, streetX: number, streetZ: number, portalOnXFace = false): LotFrame {
  const dx = box.maxX - box.minX
  const dz = box.maxZ - box.minZ
  const ox = streetX < 0 ? box.minX : box.maxX
  const oz = streetZ < 0 ? box.minZ : box.maxZ
  const inX = -streetX
  const inZ = -streetZ
  // la fachada de la calle en z (normal ±z) corre a lo largo de x, y mide dx
  if (!portalOnXFace && dx <= dz) return { ox, oz, ux: inX, uz: 0, vx: 0, vz: inZ, lu: dx, lv: dz }
  return { ox, oz, ux: 0, uz: inZ, vx: inX, vz: 0, lu: dz, lv: dx }
}

/** Dónde va el centro del local (sobre la fachada V) y si tiene almacén al fondo. */
function shopLayout(frame: LotFrame) {
  const length = frame.lv - 2 * EXTERIOR_WALL
  const store = length >= STORE_MIN_LENGTH
  const salesEnd = frame.lv - EXTERIOR_WALL - (store ? STORE_DEPTH + PARTITION : 0)
  const half = SHOP_OPENING.width / 2
  const center = Math.min(Math.max((EXTERIOR_WALL + salesEnd) / 2, EXTERIOR_WALL + half + 0.5), salesEnd - half - 0.5)
  return { store, salesEnd, center }
}

/** Las puertas de un edificio a la calle: el centro del hueco sobre la fachada y hacia dónde mira (hacia fuera). */
export function buildingDoors(frame: LotFrame, floors: number): { portal: Spot; shop: Spot } {
  const portalU = frame.lu - EXTERIOR_WALL - hallWidth(floors) / 2
  const portal = { ...toWorld(frame, portalU, 0), yaw: yawOf(dirToWorld(frame, 0, -1)) }
  const shop = { ...toWorld(frame, 0, shopLayout(frame).center), yaw: yawOf(dirToWorld(frame, -1, 0)) }
  return { portal, shop }
}

/** Planta del casetón de la azotea (escalera, rellano y ascensor), para dibujarlo desde fuera. */
export function casetonBox(frame: LotFrame, floors: number): Box {
  const entry = entryLine(frame.lv)
  return rectToBox(frame, frame.lu - EXTERIOR_WALL - coreWidth(floors), entry - LANDING - CORE_WALL, frame.lu - EXTERIOR_WALL, frame.lv - EXTERIOR_WALL)
}

/* ---------- muebles ---------- */

/** Huella (ancho w a lo largo de la pared, fondo d hacia la sala) y alto de cada mueble. Deben coincidir con crear_interiores.py. */
export interface FurnitureSpec {
  w: number
  d: number
  h: number
}

export const FURNITURE = {
  sofa: { w: 2.1, d: 0.92, h: 0.85 },
  sillon: { w: 0.9, d: 0.88, h: 0.85 },
  mesa_baja: { w: 1.1, d: 0.6, h: 0.42 },
  mueble_tv: { w: 1.8, d: 0.45, h: 1.2 },
  estanteria: { w: 1.0, d: 0.35, h: 1.9 },
  alfombra: { w: 2.0, d: 1.4, h: 0.01 },
  lampara_pie: { w: 0.4, d: 0.4, h: 1.65 },
  comedor: { w: 1.7, d: 2.0, h: 0.9 },
  silla: { w: 0.46, d: 0.5, h: 0.9 },
  cocina_bajo: { w: 0.6, d: 0.62, h: 0.92 },
  cocina_fregadero: { w: 0.6, d: 0.62, h: 0.92 },
  cocina_placa: { w: 0.6, d: 0.62, h: 0.92 },
  frigorifico: { w: 0.6, d: 0.66, h: 1.85 },
  cocina_alto: { w: 0.6, d: 0.35, h: 0.7 },
  campana: { w: 0.6, d: 0.5, h: 0.5 },
  mesa_cocina: { w: 1.0, d: 1.15, h: 0.9 },
  cama_doble: { w: 1.6, d: 2.05, h: 1.0 },
  cama_individual: { w: 0.95, d: 2.0, h: 0.9 },
  mesita: { w: 0.45, d: 0.4, h: 0.55 },
  armario: { w: 1.2, d: 0.6, h: 2.1 },
  comoda: { w: 1.0, d: 0.48, h: 0.85 },
  escritorio: { w: 1.1, d: 1.1, h: 0.9 },
  inodoro: { w: 0.4, d: 0.7, h: 0.8 },
  lavabo: { w: 0.6, d: 0.48, h: 1.9 },
  ducha: { w: 0.9, d: 0.9, h: 2.0 },
  banera: { w: 1.6, d: 0.72, h: 0.58 },
  radiador: { w: 0.8, d: 0.1, h: 0.65 },
  plafon: { w: 0.36, d: 0.36, h: 0.1 },
  planta: { w: 0.45, d: 0.45, h: 1.1 },
  buzones: { w: 1.2, d: 0.2, h: 1.9 },
  felpudo: { w: 0.9, d: 0.55, h: 0.02 },
  cuadro: { w: 0.7, d: 0.04, h: 0.5 },
  mostrador: { w: 1.8, d: 0.6, h: 1.05 },
  estanteria_tienda: { w: 1.0, d: 0.45, h: 2.0 },
  vitrina_panaderia: { w: 1.6, d: 0.7, h: 1.15 },
  expositor_farmacia: { w: 1.0, d: 0.4, h: 2.1 },
  sillon_peluqueria: { w: 0.9, d: 1.35, h: 1.9 },
  deposito: { w: 1.3, d: 1.3, h: 1.9 },
  antena: { w: 0.6, d: 0.6, h: 2.8 },
  tendedero: { w: 2.0, d: 1.3, h: 1.7 },
  maquina_aire: { w: 0.8, d: 0.35, h: 0.6 },
} as const satisfies Record<string, FurnitureSpec>

export type FurnitureModel = keyof typeof FURNITURE
/** Modelos que no son muebles: puertas, ventanas, escalera y ascensor. */
export type FixtureModel = 'puerta_interior' | 'puerta_piso' | 'ventana' | 'escalera' | 'ascensor' | 'ascensor_puerta'
export type PlanModel = FurnitureModel | FixtureModel

/** Lo que está por debajo de esta altura puede ir bajo una ventana. */
const LOW = 0.95

/* ---------- el plano en coordenadas del mundo ---------- */

export type RoomKind =
  | 'portal' | 'rellano' | 'salon' | 'cocina' | 'dormitorio' | 'bano' | 'pasillo' | 'recibidor' | 'local' | 'almacen' | 'azotea' | 'patio' | 'cerrado'
export type FloorFinish = 'parquet' | 'baldosa' | 'terrazo' | 'cubierta'
export type WallKind = 'exterior' | 'interior' | 'parapeto' | 'barandilla'

export interface PlanRoom {
  kind: RoomKind
  level: number
  box: Box
  /** acabado del suelo, o null si no se ve (zonas cerradas, el patio por encima de la primera planta) */
  floor: FloorFinish | null
  /** color de la pintura de las paredes y si van alicatadas */
  paint: number
  tiles: boolean
  /** a qué piso pertenece (-1 zonas comunes y el local) */
  flat: number
}

/** Un hueco en un muro, a lo largo de su eje (x o z del mundo) y en altura (desde el suelo de la planta). */
export interface PlanOpening {
  from: number
  to: number
  bottom: number
  top: number
}

export interface PlanWall {
  level: number
  /** el muro corre a lo largo de x (su grosor es en z) o de z */
  alongX: boolean
  /** huella, grosor incluido */
  box: Box
  /** altura sobre el suelo de la planta */
  height: number
  kind: WallKind
  openings: PlanOpening[]
  /** se dibuja (los antepechos de la azotea los dibuja la fachada de cityMesh) */
  visible: boolean
}

export interface PlanItem {
  model: PlanModel
  x: number
  z: number
  /** altura del suelo donde se apoya (la del suelo de su planta) */
  y: number
  yaw: number
  level: number
}

export interface PlanDoor extends PlanItem {
  model: 'puerta_interior' | 'puerta_piso'
  /** suena al abrirse (las de los pisos; las de dentro, no) */
  announce: boolean
}

export interface PlanLight {
  x: number
  y: number
  z: number
  level: number
}

/** La escalera, para la altura y las colisiones: dónde se entra, hacia dónde sube y hacia dónde queda cada tramo. */
export interface StairCore {
  /** centro de la línea de entrada (lado del rellano) */
  entry: Vec2
  /** unitario, del rellano hacia el fondo del núcleo */
  forward: Vec2
  /** unitario, el +X del modelo: el primer tramo (el que sube desde el rellano) va hacia −lateral */
  lateral: Vec2
  /** giro del modelo (mira hacia el rellano) */
  yaw: number
  box: Box
}

export interface ElevatorPlan {
  /** hueco libre (donde está la cabina) */
  shaft: Box
  /** dónde puede estar quien va dentro */
  cabin: Box
  /** la puerta de cada planta, en el muro del hueco: su huella, que tapa el paso mientras está cerrada */
  gap: Box
  /** modelo de la puerta de planta: centro del hueco en la cara del rellano, mirando al rellano */
  door: Spot
  /** origen de la cabina (suelo, frente) y giro */
  cabinSpot: Spot
  /** paradas: de la planta baja a la última (no sube a la azotea) */
  stops: number
}

export interface BuildingPlan {
  index: number
  floors: number
  box: Box
  frame: LotFrame
  rooms: PlanRoom[]
  walls: PlanWall[]
  items: PlanItem[]
  doors: PlanDoor[]
  lights: PlanLight[]
  /** por planta (1 … floors): el forjado sobre el que se pisa, en rectángulos; la planta baja va sobre el terreno */
  slabs: Box[][]
  /** por planta: huecos del forjado (escalera, ascensor, patio) */
  holes: Box[][]
  stair: StairCore
  elevator: ElevatorPlan | null
  /** colisiones que no dependen de la planta: la barandilla entre tramos */
  core: Box[]
  /** bajo el segundo tramo, en la planta baja (solo para quien está en el suelo, no en la escalera) */
  groundBlock: Box
  /** el hueco del primer tramo en la azotea (solo para quien está en la azotea) */
  roofBlock: Box
  shop: ShopKind
}

/* ---------- el plano en el marco del solar ---------- */

type Side = 'u0' | 'u1' | 'v0' | 'v1'

interface Rect {
  u0: number
  v0: number
  u1: number
  v1: number
}

interface LocalWall {
  level: number
  alongU: boolean
  /** coordenada del eje (v si corre a lo largo de u) */
  c: number
  a0: number
  a1: number
  t: number
  h: number
  kind: WallKind
  openings: { a0: number; a1: number; bottom: number; top: number }[]
  visible: boolean
}

interface LocalItem {
  model: PlanModel
  u: number
  v: number
  du: number
  dv: number
  level: number
  door?: { announce: boolean }
}

interface LocalRoom extends Rect {
  kind: RoomKind
  level: number
  floor: FloorFinish | null
  paint: number
  tiles: boolean
  flat: number
}

const PAINTS = [0xf1ece2, 0xeae4d6, 0xe4e9e6, 0xf0e6dc, 0xe8e2ea, 0xf3efe6, 0xdfe6ea, 0xefe9d8]
const COMMON_PAINT = 0xe6dccb
const TILE_WHITE = 0xf2f2ee
const TILE_BLUE = 0xdfe9ef

const FLOOR_OF: Record<RoomKind, FloorFinish | null> = {
  portal: 'terrazo', rellano: 'terrazo', salon: 'parquet', cocina: 'baldosa', dormitorio: 'parquet', bano: 'baldosa', pasillo: 'parquet',
  recibidor: 'parquet', local: 'terrazo', almacen: 'terrazo', azotea: 'cubierta', patio: null, cerrado: null,
}

/** Generador pseudoaleatorio con semilla (el mismo que layout.ts; aquí sin importarlo para no crear un ciclo). */
function rngFor(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SIDE_DIR: Record<Side, [number, number]> = { u0: [1, 0], u1: [-1, 0], v0: [0, 1], v1: [0, -1] }
const OPPOSITE: Record<Side, Side> = { u0: 'u1', u1: 'u0', v0: 'v1', v1: 'v0' }
const sideLength = (r: Rect, side: Side) => (side === 'u0' || side === 'u1' ? r.v1 - r.v0 : r.u1 - r.u0)
const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.u0 < b.u1 + margin && a.u1 > b.u0 - margin && a.v0 < b.v1 + margin && a.v1 > b.v0 - margin

/** Un hueco de puerta o una ventana sobre un lado de una estancia (coordenada a lo largo de ese lado). */
interface SideMark {
  side: Side
  a0: number
  a1: number
}

/** Coloca los muebles de una estancia: contra las paredes, sin tapar puertas ni ventanas y sin pisarse. */
class Placer {
  readonly r: Rect
  private readonly placed: Rect[] = []
  private readonly clear: Rect[] = []
  private readonly plan: LocalPlan
  private readonly level: number
  private readonly doors: SideMark[]
  private readonly windows: SideMark[]

  constructor(plan: LocalPlan, level: number, r: Rect, doors: SideMark[], windows: SideMark[]) {
    this.plan = plan
    this.level = level
    this.r = r
    this.doors = doors
    this.windows = windows
    // delante de cada puerta queda libre lo que barre la hoja y un poco más
    for (const door of doors) this.clear.push(this.band(door.side, door.a0 - 0.15, door.a1 + 0.15, 1.05))
  }

  get area() {
    return (this.r.u1 - this.r.u0) * (this.r.v1 - this.r.v0)
  }

  /** Franja pegada a un lado de la sala, entre `a0` y `a1` a lo largo de él y con `depth` hacia dentro. */
  private band(side: Side, a0: number, a1: number, depth: number): Rect {
    const { r } = this
    if (side === 'u0') return { u0: r.u0, u1: r.u0 + depth, v0: a0, v1: a1 }
    if (side === 'u1') return { u0: r.u1 - depth, u1: r.u1, v0: a0, v1: a1 }
    if (side === 'v0') return { v0: r.v0, v1: r.v0 + depth, u0: a0, u1: a1 }
    return { v0: r.v1 - depth, v1: r.v1, u0: a0, u1: a1 }
  }

  hasDoor(side: Side) {
    return this.doors.some((door) => door.side === side)
  }

  hasWindow(side: Side) {
    return this.windows.some((window) => window.side === side)
  }

  windowsOn(side: Side) {
    return this.windows.filter((window) => window.side === side)
  }

  /** Huella de un mueble en (u, v) mirando a lo largo de u (dv = 0) o de v. */
  footprint(model: FurnitureModel, u: number, v: number, dv: number): Rect {
    const { w, d } = FURNITURE[model]
    const alongU = Math.abs(dv) > 0.5 // mira a lo largo de v: su ancho va en u
    const hu = (alongU ? w : d) / 2
    const hv = (alongU ? d : w) / 2
    return { u0: u - hu, u1: u + hu, v0: v - hv, v1: v + hv }
  }

  /** ¿Cabe aquí? Dentro de la sala, sin pisar otro mueble ni el paso de las puertas, y si es alto, sin tapar una ventana. */
  fits(model: FurnitureModel, rect: Rect, margin = 0): boolean {
    const { r } = this
    const e = 0.005
    if (rect.u0 < r.u0 - e || rect.u1 > r.u1 + e || rect.v0 < r.v0 - e || rect.v1 > r.v1 + e) return false
    if (this.placed.some((other) => overlaps(rect, other, margin)) || this.clear.some((zone) => overlaps(rect, zone))) return false
    if (FURNITURE[model].h > LOW) {
      for (const window of this.windows) {
        const zone = this.band(window.side, window.a0 - 0.1, window.a1 + 0.1, 0.3)
        if (overlaps(rect, zone)) return false
      }
    }
    return true
  }

  /** Pone un mueble sin comprobar nada (alfombras, cuadros, lámparas de techo, radiadores). */
  free(model: PlanModel, u: number, v: number, du: number, dv: number) {
    this.plan.items.push({ model, u, v, du, dv, level: this.level })
  }

  /** Pone un mueble si cabe (con `margin` libre alrededor); devuelve su huella o null. */
  put(model: FurnitureModel, u: number, v: number, du: number, dv: number, margin = 0): Rect | null {
    const rect = this.footprint(model, u, v, dv)
    if (!this.fits(model, rect, margin)) return null
    this.placed.push(rect)
    this.free(model, u, v, du, dv)
    return rect
  }

  /** Reserva un hueco sin mueble (para que lo que viene después no lo ocupe). */
  reserve(rect: Rect) {
    this.placed.push(rect)
  }

  /** Centro de un mueble con la espalda contra `side`, a `along` a lo largo de ese lado. */
  wallSpot(model: FurnitureModel, side: Side, along: number, gap = 0.02): { u: number; v: number; du: number; dv: number } {
    const { r } = this
    const { d } = FURNITURE[model]
    const [du, dv] = SIDE_DIR[side]
    if (side === 'u0') return { u: r.u0 + gap + d / 2, v: along, du, dv }
    if (side === 'u1') return { u: r.u1 - gap - d / 2, v: along, du, dv }
    if (side === 'v0') return { u: along, v: r.v0 + gap + d / 2, du, dv }
    return { u: along, v: r.v1 - gap - d / 2, du, dv }
  }

  /** Extremos de un lado (a lo largo). */
  span(side: Side): [number, number] {
    const { r } = this
    return side === 'u0' || side === 'u1' ? [r.v0, r.v1] : [r.u0, r.u1]
  }

  /** Contra la pared `side`: 'centro', 'inicio' o 'fin' del lado, o una posición. Devuelve la posición a lo largo, o null. */
  wall(model: FurnitureModel, side: Side, where: 'centro' | 'inicio' | 'fin' | number, gap = 0.02, margin = 0): number | null {
    const [lo, hi] = this.span(side)
    const half = FURNITURE[model].w / 2
    const along = where === 'centro' ? (lo + hi) / 2 : where === 'inicio' ? lo + half + 0.03 : where === 'fin' ? hi - half - 0.03 : where
    const spot = this.wallSpot(model, side, along, gap)
    return this.put(model, spot.u, spot.v, spot.du, spot.dv, margin) ? along : null
  }

  /** Prueba varias posiciones contra varias paredes hasta que una valga. */
  anyWall(model: FurnitureModel, sides: readonly Side[], wheres: readonly ('centro' | 'inicio' | 'fin')[] = ['centro', 'inicio', 'fin'], margin = 0): { side: Side; along: number } | null {
    for (const side of sides) {
      for (const where of wheres) {
        const along = this.wall(model, side, where, 0.02, margin)
        if (along !== null) return { side, along }
      }
    }
    return null
  }

  /** Busca un hueco libre en el suelo (mesas con sillas), dejando `margin` alrededor. */
  anywhere(model: FurnitureModel, margin: number): Rect | null {
    const { r } = this
    const step = 0.2
    let best: { u: number; v: number; du: number; dv: number; score: number } | null = null
    const cu = (r.u0 + r.u1) / 2
    const cv = (r.v0 + r.v1) / 2
    for (const [du, dv] of [[0, 1], [1, 0]] as const) {
      for (let u = r.u0; u <= r.u1; u += step) {
        for (let v = r.v0; v <= r.v1; v += step) {
          const rect = this.footprint(model, u, v, dv)
          const padded = { u0: rect.u0 - margin, u1: rect.u1 + margin, v0: rect.v0 - margin, v1: rect.v1 + margin }
          // lo acolchado puede tocar las paredes, pero la mesa no
          const inside = padded.u0 >= r.u0 - margin && padded.u1 <= r.u1 + margin && padded.v0 >= r.v0 - margin && padded.v1 <= r.v1 + margin
          if (!inside || !this.fits(model, rect, margin)) continue
          // mejor cerca del centro de la sala
          const score = Math.hypot(u - cu, v - cv)
          if (!best || score < best.score) best = { u, v, du, dv, score }
        }
      }
    }
    return best ? this.put(model, best.u, best.v, best.du, best.dv, margin) : null
  }

  /** Lados ordenados: primero los que no tienen puerta, de más largo a más corto. */
  sides(filter: (side: Side) => boolean = () => true): Side[] {
    return (['u0', 'u1', 'v0', 'v1'] as Side[])
      .filter(filter)
      .sort((a, b) => Number(this.hasDoor(a)) - Number(this.hasDoor(b)) || sideLength(this.r, b) - sideLength(this.r, a))
  }

  /** Un radiador bajo cada ventana. */
  radiators() {
    for (const window of this.windows) {
      const mid = (window.a0 + window.a1) / 2
      const spot = this.wallSpot('radiador', window.side, mid, 0.04)
      this.free('radiador', spot.u, spot.v, spot.du, spot.dv)
    }
  }

  /** Un cuadro colgado en una pared libre (sin puerta ni ventana a esa altura). */
  picture(side: Side, along: number) {
    const marks = [...this.doors, ...this.windows].filter((mark) => mark.side === side)
    if (marks.some((mark) => along + 0.45 > mark.a0 && along - 0.45 < mark.a1)) return
    const spot = this.wallSpot('cuadro', side, along, 0)
    this.free('cuadro', spot.u, spot.v, spot.du, spot.dv)
  }
}

class LocalPlan {
  readonly rooms: LocalRoom[] = []
  readonly walls: LocalWall[] = []
  readonly items: LocalItem[] = []
  readonly lights: { u: number; v: number; level: number }[] = []

  wall(level: number, alongU: boolean, c: number, a0: number, a1: number, t: number, kind: WallKind = 'interior', h = WALL_HEIGHT, visible = true): LocalWall {
    const wall: LocalWall = { level, alongU, c, a0: Math.min(a0, a1), a1: Math.max(a0, a1), t, h, kind, openings: [], visible }
    if (wall.a1 - wall.a0 > 0.01) this.walls.push(wall)
    return wall
  }

  room(kind: RoomKind, level: number, r: Rect, paint: number, flat = -1, floor = FLOOR_OF[kind]): LocalRoom {
    const room: LocalRoom = { kind, level, ...r, floor, paint, tiles: kind === 'bano' || kind === 'cocina', flat }
    this.rooms.push(room)
    return room
  }

  /** Lámparas de techo: una en el centro, o una cada ~3 m si la sala es alargada. */
  ceilingLights(level: number, r: Rect) {
    const lu = r.u1 - r.u0
    const lv = r.v1 - r.v0
    const count = Math.max(1, Math.round(Math.max(lu, lv) / 3.2))
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const u = lu >= lv ? r.u0 + lu * t : (r.u0 + r.u1) / 2
      const v = lu >= lv ? (r.v0 + r.v1) / 2 : r.v0 + lv * t
      this.lights.push({ u, v, level })
      this.items.push({ model: 'plafon', u, v, du: 0, dv: 1, level })
    }
  }
}

/** Ancho mínimo e ideal de cada estancia a lo largo de su banda. */
const WIDTHS: Partial<Record<RoomKind, [number, number]>> = { salon: [3.6, 5], dormitorio: [2.6, 3.4], cocina: [2.3, 3], bano: [1.7, 2.3] }

/** Reparte `available` m entre las estancias (con tabiques entre ellas): cada una su mínimo y el resto hacia su ideal. */
function distribute(kinds: RoomKind[], available: number): number[] {
  const net = available - PARTITION * (kinds.length - 1)
  const mins = kinds.map((kind) => WIDTHS[kind]![0])
  const ideals = kinds.map((kind) => WIDTHS[kind]![1])
  let extra = net - mins.reduce((a, b) => a + b, 0)
  const widths = [...mins]
  const room = ideals.map((ideal, i) => ideal - mins[i])
  const roomTotal = room.reduce((a, b) => a + b, 0)
  const toIdeal = Math.min(extra, roomTotal)
  for (let i = 0; i < widths.length; i++) widths[i] += roomTotal > 0 ? (room[i] / roomTotal) * toIdeal : 0
  extra -= toIdeal
  // lo que sobra, a partes iguales
  for (let i = 0; i < widths.length; i++) widths[i] += extra / widths.length
  return widths
}

/** De una lista por prioridad, las que caben (con su mínimo) en `available` m. */
function fitting(kinds: RoomKind[], available: number): RoomKind[] {
  const chosen: RoomKind[] = []
  let used = 0
  for (const kind of kinds) {
    const need = WIDTHS[kind]![0] + (chosen.length ? PARTITION : 0)
    if (used + need > available) continue
    chosen.push(kind)
    used += need
  }
  return chosen
}

const SHOP_KINDS: ShopKind[] = ['tienda', 'farmacia', 'panaderia', 'peluqueria']

/** Elige el tipo de local de un edificio (determinista). */
export function shopKindFor(index: number): ShopKind {
  const rng = rngFor(9100 + index * 31)
  return SHOP_KINDS[Math.floor(rng() * SHOP_KINDS.length)]
}

/* ---------- generador ---------- */

/** Plano completo de un edificio. */
export function planBuilding(building: Building): BuildingPlan {
  const { frame, floors } = building
  const { lu, lv } = frame
  const T = EXTERIOR_WALL
  const rng = rngFor(5300 + building.index * 97)
  const plan = new LocalPlan()
  const elevator = hasElevator(floors)
  const coreW = coreWidth(floors)
  const entry = entryLine(lv)
  /** muro del núcleo del lado de los pisos (su cara de fuera) */
  const coreEdge = lu - T - coreW
  const stairU0 = lu - T - STAIR_WIDTH
  const shaft: Rect | null = elevator
    ? { u0: coreEdge + CORE_WALL, u1: stairU0 - CORE_WALL, v0: entry + CORE_WALL, v1: entry + CORE_WALL + SHAFT_DEPTH }
    : null
  const shaftU = shaft ? (shaft.u0 + shaft.u1) / 2 : 0
  const kind = building.shop?.kind ?? 'tienda'

  // muros de fachada y medianeras de una planta; devuelve los de fachada para abrir en ellos puertas y ventanas
  const shell = (level: number, h = WALL_HEIGHT, kindOf: WallKind = 'exterior', visible = true) => ({
    faceU: plan.wall(level, true, T / 2, 0, lu, T, kindOf, h, visible),
    faceV: plan.wall(level, false, T / 2, T, lv - T, T, kindOf, h, visible),
    partyU: plan.wall(level, true, lv - T / 2, 0, lu, T, kindOf, h, visible),
    partyV: plan.wall(level, false, lu - T / 2, T, lv - T, T, kindOf, h, visible),
  })

  // núcleo: muro de la escalera y, si hay ascensor, su hueco (y el cuarto de contadores detrás); iguales en todas las plantas
  const coreWalls = (level: number, roof: boolean) => {
    plan.wall(level, false, stairU0 - CORE_WALL / 2, entry, lv - T, CORE_WALL)
    if (!shaft) return
    const front = plan.wall(level, true, entry + CORE_WALL / 2, coreEdge + CORE_WALL, stairU0 - CORE_WALL, CORE_WALL)
    if (!roof) front.openings.push({ a0: shaftU - ELEVATOR_GAP / 2, a1: shaftU + ELEVATOR_GAP / 2, bottom: 0, top: 2.1 })
    plan.wall(level, true, shaft.v1 + CORE_WALL / 2, coreEdge + CORE_WALL, stairU0 - CORE_WALL, CORE_WALL)
    plan.wall(level, false, coreEdge + CORE_WALL / 2, entry, lv - T, CORE_WALL)
    plan.room('cerrado', level, { u0: shaft.u0, u1: shaft.u1, v0: shaft.v1 + CORE_WALL, v1: lv - T }, COMMON_PAINT)
  }

  /** Ventanas de una estancia en las fachadas (y las paredes al patio), alineadas con las de la fachada pintada. */
  const windowsFor = (room: LocalRoom, walls: { faceU: LocalWall; faceV: LocalWall }, patioWall?: { wall: LocalWall; until: number }): SideMark[] => {
    const marks: SideMark[] = []
    const add = (wall: LocalWall, side: Side, lo: number, hi: number, world0: number, slope: number) => {
      // coordenada del mundo a lo largo de la fachada = world0 + slope · a; las ventanas pintadas caen en 1,5 (mód. 3)
      const from = lo + 0.75
      const to = hi - 0.75
      const centers: number[] = []
      if (to >= from) {
        const k0 = Math.ceil((Math.min(world0 + slope * from, world0 + slope * to) - 1.5) / 3)
        const k1 = Math.floor((Math.max(world0 + slope * from, world0 + slope * to) - 1.5) / 3)
        for (let k = k0; k <= k1; k++) centers.push((3 * k + 1.5 - world0) / slope)
      }
      if (centers.length === 0 && hi - lo >= 1.5) centers.push((lo + hi) / 2)
      for (const a of centers) {
        const half = WINDOW.width / 2
        wall.openings.push({ a0: a - half, a1: a + half, bottom: WINDOW.sill, top: WINDOW.top })
        marks.push({ side, a0: a - half, a1: a + half })
        // la ventana, en la cara de dentro del muro, mirando a la sala
        const [du, dv] = SIDE_DIR[side]
        const u = side === 'v0' || side === 'v1' ? a : side === 'u0' ? room.u0 : room.u1
        const v = side === 'u0' || side === 'u1' ? a : side === 'v0' ? room.v0 : room.v1
        plan.items.push({ model: 'ventana', u, v, du, dv, level: room.level })
      }
    }
    const alongXU = Math.abs(frame.ux) > 0.5
    const alongXV = Math.abs(frame.vx) > 0.5
    if (Math.abs(room.v0 - T) < 0.01) add(walls.faceU, 'v0', room.u0, room.u1, alongXU ? frame.ox : frame.oz, alongXU ? frame.ux : frame.uz)
    if (Math.abs(room.u0 - T) < 0.01) add(walls.faceV, 'u0', room.v0, room.v1, alongXV ? frame.ox : frame.oz, alongXV ? frame.vx : frame.vz)
    if (patioWall && room.u1 <= patioWall.until + 0.01 && room.u1 - room.u0 >= 1.5) {
      const a = (room.u0 + room.u1) / 2
      patioWall.wall.openings.push({ a0: a - WINDOW.width / 2, a1: a + WINDOW.width / 2, bottom: WINDOW.sill, top: WINDOW.top })
      marks.push({ side: 'v1', a0: a - WINDOW.width / 2, a1: a + WINDOW.width / 2 })
      plan.items.push({ model: 'ventana', u: a, v: room.v1, du: 0, dv: -1, level: room.level })
    }
    return marks
  }

  /** Puerta de paso: hueco en el muro y modelo con la hoja abriendo hacia `into` (−1/1 en el eje perpendicular al muro). */
  const doorway = (wall: LocalWall, a: number, model: 'puerta_interior' | 'puerta_piso', into: number, announce = false) => {
    const size = model === 'puerta_piso' ? FLAT_DOOR : ROOM_DOOR
    wall.openings.push({ a0: a - size.width / 2, a1: a + size.width / 2, bottom: 0, top: size.height })
    // el frente del modelo es el lado desde el que se llega; la hoja abre hacia el otro
    const u = wall.alongU ? a : wall.c
    const v = wall.alongU ? wall.c : a
    const du = wall.alongU ? 0 : -into
    const dv = wall.alongU ? -into : 0
    plan.items.push({ model, u, v, du, dv, level: wall.level, door: { announce } })
  }

  /* --- planta baja: portal y local --- */
  {
    const level = 0
    const walls = shell(level)
    coreWalls(level, false)
    const hall: Rect = { u0: coreEdge + CORE_WALL, u1: lu - T, v0: T, v1: entry }
    plan.room('portal', level, hall, COMMON_PAINT)
    plan.room('rellano', level, { u0: stairU0, u1: lu - T, v0: entry, v1: lv - T }, COMMON_PAINT, -1, null) // la escalera
    if (shaft) plan.room('rellano', level, shaft, COMMON_PAINT, -1, null)
    // muro entre el portal y el local
    plan.wall(level, false, coreEdge + CORE_WALL / 2, T, entry, CORE_WALL)
    const portalU = lu - T - hallWidth(floors) / 2
    walls.faceU.openings.push({ a0: portalU - PORTAL_OPENING.width / 2, a1: portalU + PORTAL_OPENING.width / 2, bottom: 0, top: PORTAL_OPENING.height })
    const portal = new Placer(plan, level, hall, [{ side: 'v0', a0: portalU - 0.7, a1: portalU + 0.7 }], [])
    plan.items.push({ model: 'felpudo', u: portalU, v: T + 0.45, du: 0, dv: 1, level })
    portal.wall('buzones', 'u1', T + 2.1, 0.02)
    portal.wall('planta', 'u0', 'inicio')
    portal.picture('u0', (T + entry) / 2)
    plan.ceilingLights(level, hall)

    const shopRect: Rect = { u0: T, u1: coreEdge, v0: T, v1: lv - T }
    if (kind === 'cafe') {
      // el café (su sala está aparte y se entra con la tecla): aquí la planta baja queda cerrada
      plan.room('cerrado', level, shopRect, COMMON_PAINT)
    } else {
      const layout = shopLayout(frame)
      const sales: Rect = { ...shopRect, v1: layout.store ? layout.salesEnd : lv - T }
      const room = plan.room('local', level, sales, PAINTS[building.index % PAINTS.length])
      const front = layout.center
      walls.faceV.openings.push({ a0: front - SHOP_OPENING.width / 2, a1: front + SHOP_OPENING.width / 2, bottom: 0, top: SHOP_OPENING.height })
      const doors: SideMark[] = [{ side: 'u0', a0: front - SHOP_OPENING.width / 2, a1: front + SHOP_OPENING.width / 2 }]
      // en la fachada U (esquina) el local tiene ventanas
      const windows = windowsFor({ ...room, u0: room.u0 + 0.05 }, walls)
      let storeDoor: SideMark | null = null
      if (layout.store) {
        const storeRect: Rect = { ...shopRect, v0: layout.salesEnd + PARTITION }
        plan.room('almacen', level, storeRect, COMMON_PAINT)
        const wall = plan.wall(level, true, layout.salesEnd + PARTITION / 2, T, coreEdge, PARTITION)
        const a = coreEdge - 0.7
        doorway(wall, a, 'puerta_interior', 1)
        storeDoor = { side: 'v1', a0: a - 0.5, a1: a + 0.5 }
        const store = new Placer(plan, level, storeRect, [{ side: 'v0', a0: a - 0.5, a1: a + 0.5 }], [])
        store.anyWall('estanteria_tienda', ['v1', 'u0'], ['inicio', 'centro', 'fin'])
        store.anyWall('estanteria_tienda', ['v1', 'u0'], ['inicio', 'centro', 'fin'])
        plan.ceilingLights(level, storeRect)
      }
      furnishShop(new Placer(plan, level, sales, storeDoor ? [...doors, storeDoor] : doors, windows), kind)
      plan.ceilingLights(level, sales)
    }
  }

  /* --- plantas de pisos --- */
  const { flatRects, corridorU0, patioUntil } = upperLayout(frame, floors)
  const flatCount = flatRects.length
  const patioRects = () => patioOf(frame, floors)

  for (let level = 1; level < floors; level++) {
    const walls = shell(level)
    coreWalls(level, false)
    const corridor: Rect = { u0: corridorU0, u1: lu - T, v0: entry - LANDING, v1: entry }
    plan.room('rellano', level, corridor, COMMON_PAINT)
    plan.room('rellano', level, { u0: stairU0, u1: lu - T, v0: entry, v1: lv - T }, COMMON_PAINT, -1, null)
    if (shaft) plan.room('rellano', level, shaft, COMMON_PAINT, -1, null)
    for (const rect of patioRects()) plan.room('patio', level, rect, COMMON_PAINT, -1, level === 1 ? 'cubierta' : null)
    // muro trasero de los pisos (al pasillo común y al patio), muro del pasillo al patio y frente del patio
    const back = plan.wall(level, true, entry - LANDING - CORE_WALL / 2, T, lu - T, CORE_WALL)
    if (patioUntil > T + 0.3) plan.wall(level, false, corridorU0 - CORE_WALL / 2, entry - LANDING, entry, CORE_WALL)
    plan.wall(level, true, entry + CORE_WALL / 2, Math.max(T, patioUntil), coreEdge, CORE_WALL)
    // entre pisos vecinos
    for (let i = 1; i < flatCount; i++) plan.wall(level, false, flatRects[i].u0 - CORE_WALL / 2, T, flatRects[i].v1, CORE_WALL)
    const corridorPlacer = new Placer(plan, level, corridor, [], [])
    flatRects.forEach((rect, i) => {
      const a = flatDoorU(rect)
      doorway(back, a, 'puerta_piso', -1, true)
      corridorPlacer.free('felpudo', a, corridor.v0 + 0.32, 0, -1)
      flat(level, i, rect, walls, { wall: back, until: patioUntil })
    })
    plan.ceilingLights(level, corridor)
  }

  /** Un piso: estancias, tabiques, puertas, ventanas, muebles y luces. */
  function flat(level: number, index: number, r: Rect, walls: { faceU: LocalWall; faceV: LocalWall }, patio: { wall: LocalWall; until: number }) {
    const W = r.u1 - r.u0
    const D = r.v1 - r.v0
    const area = W * D
    const flatId = level * 10 + index
    const paintRng = rngFor(building.index * 1000 + flatId)
    const paint = () => PAINTS[Math.floor(paintRng() * PAINTS.length)]
    const dorms = area < 55 ? 1 : area < 90 ? 2 : 3
    const baths = area >= 105 ? 2 : 1
    const full = D >= 7.2
    const doorU = flatDoorU(r)

    let df: number
    let backBand: Rect | null = null
    if (full) {
      df = Math.min(5, Math.max(3.4, D * 0.5))
      if (D - df - 1.3 < 2.1) df = D - 3.4
    } else df = D - 1.2
    const front: Rect = { ...r, v1: r.v0 + df }
    const hallV0 = r.v0 + df + PARTITION
    const hallV1 = full ? hallV0 + 1.1 : r.v1
    const hall: Rect = { u0: r.u0, u1: r.u1, v0: hallV0, v1: hallV1 }
    plan.room('pasillo', level, hall, paint(), flatId)
    const wallA = plan.wall(level, true, r.v0 + df + PARTITION / 2, r.u0, r.u1, PARTITION)
    let wallB: LocalWall | null = null
    const hallDoors: SideMark[] = [{ side: 'v1', a0: doorU - 0.6, a1: doorU + 0.6 }]
    if (full) {
      const recibidor: Rect = { u0: r.u1 - 1.4, u1: r.u1, v0: hallV1, v1: r.v1 }
      plan.room('recibidor', level, recibidor, paint(), flatId)
      wallB = plan.wall(level, true, hallV1 + PARTITION / 2, r.u0, recibidor.u0 - PARTITION, PARTITION)
      plan.wall(level, false, recibidor.u0 - PARTITION / 2, hallV1, r.v1, PARTITION)
      backBand = { u0: r.u0, u1: recibidor.u0 - PARTITION, v0: hallV1 + PARTITION, v1: r.v1 }
      const recibidorPlacer = new Placer(plan, level, recibidor, [{ side: 'v1', a0: doorU - 0.6, a1: doorU + 0.6 }], [])
      recibidorPlacer.picture('u1', (recibidor.v0 + recibidor.v1) / 2)
      plan.ceilingLights(level, recibidor)
    }

    // qué estancias van delante (con fachada) y cuáles detrás
    const wantFront: RoomKind[] = full ? ['salon', ...Array<RoomKind>(dorms).fill('dormitorio'), 'cocina'] : ['salon', 'bano', ...Array<RoomKind>(dorms).fill('dormitorio'), 'cocina']
    let frontKinds = fitting(wantFront, W)
    const placedCount = (kinds: RoomKind[], k: RoomKind) => kinds.filter((x) => x === k).length
    let backKinds: RoomKind[] = []
    if (backBand) {
      const wantBack: RoomKind[] = [...Array<RoomKind>(baths).fill('bano')]
      if (!frontKinds.includes('cocina')) wantBack.push('cocina')
      for (let i = placedCount(frontKinds, 'dormitorio'); i < dorms; i++) wantBack.push('dormitorio')
      backKinds = fitting(wantBack, backBand.u1 - backBand.u0)
    }
    if (!frontKinds.includes('bano') && !backKinds.includes('bano')) {
      // sin baño no hay piso: sustituye al último dormitorio de delante
      const i = frontKinds.lastIndexOf('dormitorio')
      if (i >= 0) frontKinds[i] = 'bano'
      frontKinds = fitting(frontKinds, W)
    }
    const openKitchen = !frontKinds.includes('cocina') && !backKinds.includes('cocina')
    // orden: el salón en la esquina (en el piso de la esquina tiene dos fachadas); detrás, los baños junto al recibidor
    const order: Record<RoomKind, number> = { salon: 0, dormitorio: 1, cocina: 2, bano: 3 } as Record<RoomKind, number>
    frontKinds.sort((a, b) => order[a] - order[b])
    backKinds.sort((a, b) => order[a] - order[b])

    const band = (kinds: RoomKind[], rect: Rect, doorWall: LocalWall | null, doorSide: Side) => {
      const widths = distribute(kinds, rect.u1 - rect.u0)
      let u = rect.u0
      kinds.forEach((roomKind, i) => {
        const u1 = i === kinds.length - 1 ? rect.u1 : u + widths[i]
        const roomRect: Rect = { ...rect, u0: u, u1 }
        const room = plan.room(roomKind, level, roomRect, roomKind === 'bano' ? TILE_BLUE : roomKind === 'cocina' ? TILE_WHITE : paint(), flatId)
        if (i < kinds.length - 1) plan.wall(level, false, u1 + PARTITION / 2, rect.v0, rect.v1, PARTITION)
        // la puerta, al pasillo, cerca del lado del recibidor
        const doors: SideMark[] = []
        if (doorWall) {
          const width = u1 - u
          const a = width >= 1.6 ? u1 - 0.6 : (u + u1) / 2
          doorway(doorWall, a, 'puerta_interior', doorSide === 'v1' ? -1 : 1)
          doors.push({ side: doorSide, a0: a - 0.45, a1: a + 0.45 })
        }
        const windows = windowsFor(room, walls, doorSide === 'v0' ? patio : undefined)
        const placer = new Placer(plan, level, roomRect, doors, windows)
        furnishRoom(placer, roomKind, openKitchen && roomKind === 'salon')
        plan.ceilingLights(level, roomRect)
        u = u1 + PARTITION
      })
    }
    band(frontKinds, front, wallA, 'v1')
    if (backBand && wallB) band(backKinds, backBand, wallB, 'v0')
    // el pasillo: puertas a las estancias en las dos paredes largas y la de entrada
    const hallPlacer = new Placer(plan, level, hall, hallDoors, [])
    if (W > 5) hallPlacer.picture('v0', r.u0 + 1.2)
    plan.ceilingLights(level, hall)
  }

  /* --- azotea --- */
  {
    const level = floors
    shell(level, PARAPET, 'parapeto', false)
    // el casetón: la escalera, el rellano y el ascensor, con su puerta a la azotea; sus muros llegan arriba
    coreWalls(level, true)
    plan.wall(level, true, lv - T / 2, coreEdge, lu, T, 'exterior')
    plan.wall(level, false, lu - T / 2, entry - LANDING - CORE_WALL, lv - T, T, 'exterior')
    const front = plan.wall(level, true, entry - LANDING - CORE_WALL / 2, coreEdge, lu - T, CORE_WALL, 'exterior')
    plan.wall(level, false, coreEdge + CORE_WALL / 2, entry - LANDING, entry, CORE_WALL, 'exterior')
    const landing: Rect = { u0: coreEdge + CORE_WALL, u1: lu - T, v0: entry - LANDING, v1: entry }
    plan.room('rellano', level, landing, COMMON_PAINT)
    plan.room('rellano', level, { u0: stairU0, u1: lu - T, v0: entry, v1: lv - T }, COMMON_PAINT, -1, null)
    if (shaft) plan.room('cerrado', level, { u0: shaft.u0, u1: shaft.u1, v0: shaft.v0, v1: shaft.v1 }, COMMON_PAINT)
    const doorA = (landing.u0 + landing.u1) / 2
    doorway(front, doorA, 'puerta_piso', 1, true)
    plan.ceilingLights(level, landing)
    // el patio de luces queda abierto, con una barandilla alrededor
    const patios = patioRects()
    for (const rect of patios) plan.room('patio', level, rect, COMMON_PAINT, -1, null)
    const rail = (alongU: boolean, c: number, a0: number, a1: number) => plan.wall(level, alongU, c, a0, a1, 0.12, 'parapeto', 1.0)
    if (patioUntil > T + 0.3) {
      rail(true, entry - LANDING - 0.06, T, patioUntil + 0.12)
      rail(false, patioUntil + 0.06, entry - LANDING, entry)
      rail(true, entry - 0.06, patioUntil, coreEdge)
    } else rail(true, entry - 0.06, T, coreEdge)
    // el resto es azotea: lo que no es casetón ni patio
    const roofArea: Rect = { u0: T, u1: lu - T, v0: T, v1: lv - T }
    const casetonRect: Rect = { u0: coreEdge, u1: lu - T, v0: entry - LANDING - CORE_WALL, v1: lv - T }
    const roofPieces = subtract(roofArea, [casetonRect, ...patios.map((p) => ({ ...p, v0: p.v0 - 0.12 }))])
    for (const piece of roofPieces) plan.room('azotea', level, piece, COMMON_PAINT)
    // los trastos de la azotea, en el trozo más grande (delante, el que da a la calle)
    const biggest = roofPieces.reduce((a, b) => ((b.u1 - b.u0) * (b.v1 - b.v0) > (a.u1 - a.u0) * (a.v1 - a.v0) ? b : a), roofPieces[0])
    if (biggest) {
      const doorMark: SideMark[] = casetonRect.v0 - 0.2 <= biggest.v1 && doorA >= biggest.u0 && doorA <= biggest.u1 ? [{ side: 'v1', a0: doorA - 0.8, a1: doorA + 0.8 }] : []
      const roof = new Placer(plan, level, biggest, doorMark, [])
      roof.wall('deposito', 'u0', 'fin', 0.15)
      roof.wall('antena', 'v0', 'inicio', 0.2)
      if (rng() < 0.7) roof.wall('antena', 'u0', 'inicio', 0.2)
      roof.anywhere('tendedero', 0.5)
      roof.wall('maquina_aire', 'v0', 'centro', 0.1)
      roof.wall('maquina_aire', 'v0', 'fin', 0.1)
    }
  }

  return toWorldPlan(building, plan, { entry, coreEdge, stairU0, shaft, shaftU, patios: patioRects(), kind })
}

/** La puerta de un piso, en su muro trasero, cerca del lado del núcleo. */
const flatDoorU = (r: Rect) => r.u1 - 0.75

/**
 * Reparto de las plantas de pisos: los pisos ocupan la franja delantera (1, 2 o 3 según la superficie); el rellano se
 * alarga hacia ellos como pasillo común hasta la puerta del de más a la izquierda; lo que queda detrás es patio de luces.
 */
function upperLayout(frame: LotFrame, floors: number) {
  const T = EXTERIOR_WALL
  const entry = entryLine(frame.lv)
  const coreEdge = frame.lu - T - coreWidth(floors)
  const depth = entry - LANDING - CORE_WALL - T
  const width = frame.lu - 2 * T
  const count = width * depth > 150 && width >= 2 * 6.5 ? (width * depth > 250 && width >= 3 * 6 ? 3 : 2) : 1
  const flatWidth = (width - CORE_WALL * (count - 1)) / count
  const flatRects: Rect[] = []
  for (let i = 0; i < count; i++) {
    const u0 = T + i * (flatWidth + CORE_WALL)
    flatRects.push({ u0, u1: u0 + flatWidth, v0: T, v1: entry - LANDING - CORE_WALL })
  }
  const corridorU0 = Math.max(T, Math.min(coreEdge + CORE_WALL, Math.min(...flatRects.map(flatDoorU)) - 0.75))
  return { flatRects, corridorU0, patioUntil: corridorU0 - CORE_WALL, entry, coreEdge }
}

/** El patio de luces (en el marco del solar): detrás del pasillo común y junto al núcleo. */
function patioOf(frame: LotFrame, floors: number): Rect[] {
  const { patioUntil, entry, coreEdge } = upperLayout(frame, floors)
  const T = EXTERIOR_WALL
  const rects: Rect[] = [{ u0: T, u1: coreEdge, v0: entry, v1: frame.lv - T }]
  if (patioUntil > T + 0.3) rects.push({ u0: T, u1: patioUntil, v0: entry - LANDING, v1: entry })
  return rects
}

/** El patio de luces en el mundo (de la primera planta a la azotea), para la carcasa de cityMesh. */
export function patioBoxes(frame: LotFrame, floors: number): Box[] {
  return patioOf(frame, floors).map((r) => rectToBox(frame, r.u0, r.v0, r.u1, r.v1))
}

/** Una caja del suelo menos otras, en cajas (para la azotea de la carcasa, sin el hueco del patio). */
export function subtractBoxes(outer: Box, holes: Box[]): Box[] {
  const toRect = (b: Box): Rect => ({ u0: b.minX, u1: b.maxX, v0: b.minZ, v1: b.maxZ })
  return subtract(toRect(outer), holes.map(toRect)).map((r) => ({ minX: r.u0, maxX: r.u1, minZ: r.v0, maxZ: r.v1 }))
}

/** Rectángulo menos otros, en trozos rectangulares (cuadrícula con los cortes de todos, fusionada por filas). */
function subtract(outer: Rect, holes: Rect[]): Rect[] {
  const us = new Set([outer.u0, outer.u1])
  const vs = new Set([outer.v0, outer.v1])
  for (const h of holes) {
    for (const u of [h.u0, h.u1]) if (u > outer.u0 && u < outer.u1) us.add(u)
    for (const v of [h.v0, h.v1]) if (v > outer.v0 && v < outer.v1) vs.add(v)
  }
  const U = [...us].sort((a, b) => a - b)
  const V = [...vs].sort((a, b) => a - b)
  const pieces: Rect[] = []
  for (let j = 0; j < V.length - 1; j++) {
    let run: Rect | null = null
    for (let i = 0; i < U.length - 1; i++) {
      const cell = { u0: U[i], u1: U[i + 1], v0: V[j], v1: V[j + 1] }
      const mu = (cell.u0 + cell.u1) / 2
      const mv = (cell.v0 + cell.v1) / 2
      const empty = !holes.some((h) => mu > h.u0 && mu < h.u1 && mv > h.v0 && mv < h.v1)
      if (empty && run) run.u1 = cell.u1
      else if (empty) run = { ...cell }
      else if (run) {
        pieces.push(run)
        run = null
      }
    }
    if (run) pieces.push(run)
  }
  return pieces.filter((p) => p.u1 - p.u0 > 0.05 && p.v1 - p.v0 > 0.05)
}

/** Muebles de una estancia de un piso. */
function furnishRoom(p: Placer, kind: RoomKind, openKitchen: boolean) {
  if (kind === 'salon') furnishSalon(p, openKitchen)
  else if (kind === 'cocina') kitchenRun(p, true)
  else if (kind === 'dormitorio') furnishBedroom(p)
  else if (kind === 'bano') furnishBathroom(p)
  if (kind !== 'bano') p.radiators()
}

/** Muebles de cocina en fila contra la pared más larga sin puerta, y arriba los altos y la campana. */
function kitchenRun(p: Placer, withTable: boolean) {
  const sides = p.sides((side) => !p.hasDoor(side))
  for (const side of sides.length ? sides : p.sides()) {
    const [lo, hi] = p.span(side)
    const count = Math.floor((hi - lo - 0.1) / 0.6)
    if (count < 3) continue
    const sequence: FurnitureModel[] = ['frigorifico', 'cocina_bajo', 'cocina_fregadero', 'cocina_bajo', 'cocina_placa']
    while (sequence.length < count) sequence.push('cocina_bajo')
    let placed = 0
    for (let i = 0; i < Math.min(count, 8); i++) {
      const along = lo + 0.05 + 0.3 + i * 0.6
      // si un módulo no cabe aquí (una ventana para el frigorífico, el paso de una puerta), se prueba en el hueco siguiente
      const model = sequence[placed] ?? 'cocina_bajo'
      if (p.wall(model, side, along) === null) continue
      placed++
      // arriba: la campana sobre la placa, armarios altos sobre el resto (no sobre el frigorífico ni las ventanas)
      const spot = p.wallSpot('cocina_alto', side, along)
      const window = p.windowsOn(side).some((w) => along + 0.3 > w.a0 && along - 0.3 < w.a1)
      if (model === 'cocina_placa') {
        const hood = p.wallSpot('campana', side, along)
        p.free('campana', hood.u, hood.v, hood.du, hood.dv)
      } else if (model !== 'frigorifico' && !window) p.free('cocina_alto', spot.u, spot.v, spot.du, spot.dv)
    }
    if (placed >= 3) break
  }
  if (withTable) p.anyWall('mesa_cocina', p.sides(), ['centro', 'inicio', 'fin'], 0.1)
}

function furnishSalon(p: Placer, openKitchen: boolean) {
  if (openKitchen) kitchenRun(p, false)
  // sofá contra una pared, mesa baja delante y el mueble de la tele enfrente
  for (const side of p.sides()) {
    const along = p.wall('sofa', side, 'centro', 0.05) ?? p.wall('sofa', side, 'inicio', 0.05) ?? p.wall('sofa', side, 'fin', 0.05)
    if (along === null) continue
    const sofa = p.wallSpot('sofa', side, along, 0.05)
    const reach = FURNITURE.sofa.d / 2 + 0.4 + FURNITURE.mesa_baja.d / 2
    const mu = sofa.u + sofa.du * reach
    const mv = sofa.v + sofa.dv * reach
    p.free('alfombra', mu, mv, sofa.du, sofa.dv)
    p.put('mesa_baja', mu, mv, sofa.du, sofa.dv)
    const opposite = OPPOSITE[side]
    const depth = side === 'u0' || side === 'u1' ? p.r.u1 - p.r.u0 : p.r.v1 - p.r.v0
    if (depth >= FURNITURE.sofa.d + FURNITURE.mueble_tv.d + 1.9) p.wall('mueble_tv', opposite, along)
    // un sillón a un lado de la mesa, mirando hacia ella
    const perp: [number, number] = [sofa.dv, -sofa.du]
    for (const s of [1, -1]) {
      const su = mu + perp[0] * s * 1.15
      const sv = mv + perp[1] * s * 1.15
      if (p.put('sillon', su, sv, -perp[0] * s, -perp[1] * s)) break
    }
    // lámpara de pie junto al sofá
    p.wall('lampara_pie', side, along + 1.35) ?? p.wall('lampara_pie', side, along - 1.35)
    p.picture(side, along)
    break
  }
  if (p.area >= 15) p.anywhere('comedor', 0.25)
  p.anyWall('estanteria', p.sides((side) => !p.hasWindow(side)), ['inicio', 'fin', 'centro'])
  p.anyWall('planta', p.sides(), ['fin', 'inicio'])
}

function furnishBedroom(p: Placer) {
  const w = p.r.u1 - p.r.u0
  const d = p.r.v1 - p.r.v0
  const big = Math.min(w, d) >= 2.9 && p.area >= 9.5
  const bed: FurnitureModel = big ? 'cama_doble' : 'cama_individual'
  // el cabecero contra una pared sin puerta ni ventana si se puede
  const sides = [...p.sides((side) => !p.hasWindow(side)), ...p.sides((side) => p.hasWindow(side))]
  for (const side of sides) {
    const along = big ? p.wall(bed, side, 'centro') : (p.wall(bed, side, 'inicio') ?? p.wall(bed, side, 'fin'))
    if (along === null) continue
    const half = FURNITURE[bed].w / 2 + FURNITURE.mesita.w / 2 + 0.03
    if (big) {
      p.wall('mesita', side, along - half)
      p.wall('mesita', side, along + half)
    } else p.wall('mesita', side, along + half) ?? p.wall('mesita', side, along - half)
    p.picture(side, along)
    break
  }
  p.anyWall('armario', p.sides((side) => !p.hasWindow(side)), ['fin', 'inicio', 'centro'])
  const windowSides = p.sides((side) => p.hasWindow(side))
  if (!big) p.anyWall('escritorio', [...windowSides, ...p.sides()], ['centro', 'inicio', 'fin'])
  else p.anyWall('comoda', [...windowSides, ...p.sides()], ['centro', 'inicio', 'fin'])
}

function furnishBathroom(p: Placer) {
  const sides = p.sides()
  const long = sides.find((side) => sideLength(p.r, side) >= FURNITURE.banera.w + 0.02 && !p.hasDoor(side))
  if (!(long && p.wall('banera', long, 'centro'))) p.anyWall('ducha', sides, ['inicio', 'fin'])
  p.anyWall('lavabo', sides, ['centro', 'inicio', 'fin'])
  p.anyWall('inodoro', sides, ['fin', 'inicio', 'centro'])
}

function furnishShop(p: Placer, kind: ShopKind) {
  // el escaparate está en u0; el fondo (u1) es el muro del portal
  const back: Side = 'u1'
  const [lo, hi] = p.span(back)
  const fill = (model: FurnitureModel, side: Side) => {
    const [a, b] = p.span(side)
    const w = FURNITURE[model].w
    for (let along = a + w / 2 + 0.05; along + w / 2 <= b - 0.05; along += w) p.wall(model, side, along)
  }
  const counterAt = (model: FurnitureModel, offset: number) => {
    // mostrador o vitrina paralelos al fondo, con sitio detrás para quien atiende
    const spot = p.wallSpot(model, back, (lo + hi) / 2, offset)
    p.put(model, spot.u, spot.v, spot.du, spot.dv)
  }
  if (kind === 'tienda') {
    fill('estanteria_tienda', back)
    fill('estanteria_tienda', 'v1')
    const along = p.r.v0 + 1.4
    const spot = p.wallSpot('mostrador', 'u0', along, 0.9)
    p.put('mostrador', spot.u, spot.v, 0, 1)
  } else if (kind === 'farmacia') {
    fill('expositor_farmacia', back)
    counterAt('mostrador', 1.25)
    fill('expositor_farmacia', 'v1')
  } else if (kind === 'panaderia') {
    fill('estanteria_tienda', back)
    counterAt('vitrina_panaderia', 1.2)
  } else if (kind === 'peluqueria') {
    // los sillones, en el fondo (en la pared del almacén taparían su puerta)
    fill('sillon_peluqueria', back)
    p.anyWall('silla', ['v0'], ['inicio', 'centro', 'fin'])
    p.anyWall('silla', ['v0'], ['inicio', 'centro', 'fin'])
    p.anyWall('silla', ['v0'], ['inicio', 'centro', 'fin'])
  }
  p.anyWall('planta', ['u0', 'v0'], ['inicio', 'fin'])
}

/* ---------- del marco del solar al mundo ---------- */

interface CoreInfo {
  entry: number
  coreEdge: number
  stairU0: number
  shaft: Rect | null
  shaftU: number
  patios: Rect[]
  kind: ShopKind
}

function toWorldPlan(building: Building, local: LocalPlan, core: CoreInfo): BuildingPlan {
  const { frame, floors } = building
  const T = EXTERIOR_WALL
  const box = (r: Rect) => rectToBox(frame, r.u0, r.v0, r.u1, r.v1)
  const alongXOf = (alongU: boolean) => (alongU ? Math.abs(frame.ux) > 0.5 : Math.abs(frame.vx) > 0.5)
  // coordenada del mundo a lo largo de un muro: la de su eje
  const worldAlong = (alongU: boolean, a: number) => {
    const p = alongU ? toWorld(frame, a, 0) : toWorld(frame, 0, a)
    return alongXOf(alongU) ? p.x : p.z
  }

  const rooms: PlanRoom[] = local.rooms.map((r) => ({ kind: r.kind, level: r.level, box: box(r), floor: r.floor, paint: r.paint, tiles: r.tiles, flat: r.flat }))
  const walls: PlanWall[] = local.walls.map((w) => {
    const rect = w.alongU ? { u0: w.a0, u1: w.a1, v0: w.c - w.t / 2, v1: w.c + w.t / 2 } : { v0: w.a0, v1: w.a1, u0: w.c - w.t / 2, u1: w.c + w.t / 2 }
    return {
      level: w.level,
      alongX: alongXOf(w.alongU),
      box: box(rect),
      height: w.h,
      kind: w.kind,
      visible: w.visible,
      openings: w.openings.map((o) => {
        const a = worldAlong(w.alongU, o.a0)
        const b = worldAlong(w.alongU, o.a1)
        return { from: Math.min(a, b), to: Math.max(a, b), bottom: o.bottom, top: o.top }
      }),
    }
  })
  const items: PlanItem[] = []
  const doors: PlanDoor[] = []
  for (const item of local.items) {
    const p = toWorld(frame, item.u, item.v)
    const yaw = yawOf(dirToWorld(frame, item.du, item.dv))
    const placed = { model: item.model, x: p.x, z: p.z, y: levelY(item.level), yaw, level: item.level }
    if (item.door) doors.push({ ...placed, model: item.model as PlanDoor['model'], announce: item.door.announce })
    else items.push(placed)
  }
  const lights = local.lights.map((l) => {
    const p = toWorld(frame, l.u, l.v)
    return { x: p.x, z: p.z, y: levelY(l.level) + WALL_HEIGHT - 0.25, level: l.level }
  })

  // forjados y huecos
  const inner: Rect = { u0: T, u1: frame.lu - T, v0: T, v1: frame.lv - T }
  const stairRect: Rect = { u0: core.stairU0, u1: frame.lu - T, v0: core.entry, v1: frame.lv - T }
  const slabs: Box[][] = [[]]
  const holes: Box[][] = [[]]
  for (let level = 1; level <= floors; level++) {
    const levelHoles: Rect[] = [stairRect]
    if (core.shaft && level < floors) levelHoles.push(core.shaft)
    if (level >= 2) levelHoles.push(...core.patios)
    holes.push(levelHoles.map(box))
    slabs.push(subtract(inner, levelHoles).map(box))
  }

  // escalera
  const uc = frame.lu - T - STAIR_WIDTH / 2
  const entry = toWorld(frame, uc, core.entry)
  const forward = dirToWorld(frame, 0, 1)
  const yaw = yawOf({ x: -forward.x, z: -forward.z })
  const lateral = { x: Math.cos(yaw), z: -Math.sin(yaw) }
  // caja en el mundo a partir de rangos a lo largo (s) y de lado (lat) de la escalera
  const stairBox = (s0: number, s1: number, l0: number, l1: number): Box => {
    const xs: number[] = []
    const zs: number[] = []
    for (const s of [s0, s1]) {
      for (const l of [l0, l1]) {
        xs.push(entry.x + forward.x * s + lateral.x * l)
        zs.push(entry.z + forward.z * s + lateral.z * l)
      }
    }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
  }
  const half = STAIR_WIDTH / 2
  const gap = STAIR_GAP / 2
  for (let level = 0; level < floors; level++) items.push({ model: 'escalera', x: entry.x, z: entry.z, y: levelY(level), yaw, level })
  // en la planta baja, bajo el segundo tramo, una planta
  const plant = { x: entry.x + forward.x * 0.4 + lateral.x * (gap + STAIR_LANE / 2), z: entry.z + forward.z * 0.4 + lateral.z * (gap + STAIR_LANE / 2) }
  items.push({ model: 'planta', x: plant.x, z: plant.z, y: levelY(0), yaw, level: 0 })
  // en la azotea, una barandilla cierra el hueco del primer tramo
  const roofRail = stairBox(0, 0.05, -half, -gap)
  walls.push({ level: floors, alongX: Math.abs(lateral.x) > 0.5, box: roofRail, height: 1.0, kind: 'barandilla', openings: [], visible: true })

  // ascensor
  let elevator: ElevatorPlan | null = null
  if (core.shaft) {
    const s = core.shaft
    const doorPoint = toWorld(frame, core.shaftU, core.entry)
    const out = dirToWorld(frame, 0, -1)
    const cabinPoint = toWorld(frame, core.shaftU, s.v0 + 0.02)
    elevator = {
      shaft: box(s),
      cabin: box({ u0: s.u0 + 0.15, u1: s.u1 - 0.15, v0: s.v0 + 0.1, v1: s.v1 - 0.15 }),
      gap: box({ u0: core.shaftU - ELEVATOR_GAP / 2, u1: core.shaftU + ELEVATOR_GAP / 2, v0: core.entry, v1: core.entry + CORE_WALL }),
      door: { ...doorPoint, yaw: yawOf(out) },
      cabinSpot: { ...cabinPoint, yaw: yawOf(out) },
      stops: floors,
    }
  }

  return {
    index: building.index,
    floors,
    box: building.box,
    frame,
    rooms,
    walls,
    items,
    doors,
    lights,
    slabs,
    holes,
    stair: { entry, forward, lateral, yaw, box: box(stairRect) },
    elevator,
    core: [stairBox(0, STAIR_RUN, -gap, gap)],
    groundBlock: stairBox(0, STAIR_RUN, gap, half),
    roofBlock: stairBox(-0.05, 0.15, -half, -gap),
    shop: core.kind,
  }
}

/* ---------- altura y planta ---------- */

/** Planta a la que corresponde una altura (en la escalera cambia a medio tramo). */
export function levelOf(plan: Pick<BuildingPlan, 'floors'>, y: number): number {
  return Math.max(0, Math.min(plan.floors, Math.floor((y - GROUND_FLOOR_Y + 0.5) / FLOOR_HEIGHT)))
}

/** Posición en la escalera: a lo largo (desde la entrada) y de lado (negativo = primer tramo). */
export function stairCoords(stair: StairCore, x: number, z: number): { s: number; lat: number } {
  const dx = x - stair.entry.x
  const dz = z - stair.entry.z
  return { s: dx * stair.forward.x + dz * stair.forward.z, lat: dx * stair.lateral.x + dz * stair.lateral.z }
}

/** Altura sobre un tramo, de 0 (en la planta) a 3 (en la siguiente): la línea que pasa por el centro de las huellas. */
export function stairRise(s: number, lat: number): number | null {
  if (s < 0 || s > CORE_LENGTH || Math.abs(lat) > STAIR_WIDTH / 2) return null
  if (s >= STAIR_RUN) return 1.5
  if (lat < 0) return Math.min(1.5, Math.max(0, RISER * (s / TREAD + 0.5)))
  return Math.min(3, Math.max(1.5, 1.5 + RISER * ((STAIR_RUN - s) / TREAD + 0.5)))
}

/**
 * Altura del suelo en (x, z) para quien está a la altura `y`: en la escalera, la del tramo de la planta que quede más
 * cerca (nunca salta: las alturas posibles están a 1,5 m o más unas de otras); fuera de ella, la de su planta.
 */
export function heightAt(plan: Pick<BuildingPlan, 'floors' | 'stair'>, x: number, z: number, y: number): number {
  const { s, lat } = stairCoords(plan.stair, x, z)
  const rise = stairRise(s, lat)
  if (rise === null) return levelY(levelOf(plan, y))
  let best = levelY(levelOf(plan, y))
  let bestGap = Infinity
  for (let level = 0; level < plan.floors; level++) {
    const candidate = levelY(level) + rise
    const gap = Math.abs(candidate - y)
    if (gap < bestGap) {
      best = candidate
      bestGap = gap
    }
  }
  return best
}

export function inBox(box: Box, x: number, z: number, margin = 0): boolean {
  return x >= box.minX - margin && x <= box.maxX + margin && z >= box.minZ - margin && z <= box.maxZ + margin
}
