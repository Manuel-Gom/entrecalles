import { buildingDoors, buildingHeight, lotFrame, shopKindFor, type LotFrame } from './buildingPlan'
import { boxAt, type Box, type Vec2 } from './collision'

/** Generador pseudoaleatorio con semilla (mulberry32): el mismo número da siempre el mismo barrio. */
export function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export type Rng = () => number

/* Medidas del barrio, en metros. Manzanas de 30 × 30 separadas por calles de 16: 8 de calzada (dos carriles) y 4 de acera a cada lado. */
export const BLOCK_HALF = 15
export const SIDEWALK = 4
export const ROAD_WIDTH = 8
export const BLOCK_PITCH = 2 * (BLOCK_HALF + SIDEWALK) + ROAD_WIDTH
/** Mitad del lado de la manzana más su acera: el borde exterior de la acera. */
export const RING_OUTER = BLOCK_HALF + SIDEWALK
/** Línea por la que se anda: separada de la fachada para dejar sitio a los bancos y del bordillo para las farolas y los árboles. */
export const RING_WALK = BLOCK_HALF + 2
/** Distancia al centro de la manzana de los bancos (pegados a la fachada), de los escaparates y de árboles y farolas (en el bordillo). */
const BENCH_DISTANCE = BLOCK_HALF + 0.3
const WINDOW_DISTANCE = BLOCK_HALF + 0.85
export const CURB_DISTANCE = RING_OUTER - 0.5
export const BLOCK_CENTERS = [-BLOCK_PITCH, 0, BLOCK_PITCH] as const
/** Ejes de las calles, entre manzanas y en el perímetro. */
const OUTER_STREET = BLOCK_PITCH + RING_OUTER + ROAD_WIDTH / 2
export const STREET_CENTERS = [-OUTER_STREET, -BLOCK_PITCH / 2, BLOCK_PITCH / 2, OUTER_STREET] as const
/** Mitad del lado del mundo (hasta el borde exterior de las calles perimetrales). */
export const WORLD_HALF = BLOCK_PITCH + RING_OUTER + ROAD_WIDTH
/** Media anchura de un paso de peatones (m), medida a lo largo de la calle que cruza. Sus bandas van paralelas a la calzada. */
export const CROSSING_HALF_WIDTH = 1.5
/** Farolas a lo largo de cada lado de manzana (m desde su centro). Las de enfrente van desfasadas (al tresbolillo). */
export const LAMP_OFFSETS = { positive: [-11, 4], negative: [-4, 11] } as const
/** Un árbol como mucho entre cada dos farolas de un lado, a esta distancia mínima de cualquier farola (m). */
export const TREE_LAMP_GAP = 5
export const SIDEWALK_HEIGHT = 0.05
/** Altura del césped y de los paseos del parque, y media anchura de los paseos (m). */
export const LAWN_HEIGHT = 0.03
export const PATH_HEIGHT = 0.035
export const PATH_HALF_WIDTH = 1.2

export type Ground = 'acera' | 'paseo' | 'hierba' | 'calzada'

/** Qué suelo hay en un punto de la calle: la acera que rodea cada manzana, el césped y los paseos del parque o la calzada. */
export function groundAt(x: number, z: number): Ground {
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      const reach = Math.max(Math.abs(x - cx), Math.abs(z - cz))
      if (reach > RING_OUTER) continue
      if (reach >= BLOCK_HALF) return 'acera'
      // el centro del parque es césped, salvo los dos paseos que lo cruzan
      if (cx === 0 && cz === 0) return Math.abs(x) < PATH_HALF_WIDTH || Math.abs(z) < PATH_HALF_WIDTH ? 'paseo' : 'hierba'
      return 'acera' // dentro de un edificio no se llega, pero se da un valor
    }
  }
  return 'calzada'
}

const GROUND_TOP: Record<Ground, number> = { acera: SIDEWALK_HEIGHT, paseo: PATH_HEIGHT, hierba: LAWN_HEIGHT, calzada: 0 }
/** Altura mínima de los pies: lo que siempre se usó en la calzada, para que las suelas no rocen el asfalto. */
export const FOOT_MIN = 0.025

/** Altura de la cara de arriba del suelo en un punto de la calle (donde se apoyan los bancos). */
export function groundTop(x: number, z: number): number {
  return GROUND_TOP[groundAt(x, z)]
}

/** Altura a la que van los pies de un personaje en la calle: justo encima del suelo que pisa. */
export function footHeight(x: number, z: number): number {
  return Math.max(FOOT_MIN, groundTop(x, z) + 0.005)
}

export type ShopKind = 'tienda' | 'farmacia' | 'panaderia' | 'peluqueria' | 'cafe'

export interface Building {
  box: Box
  /** altura de la fachada: las plantas (de FLOOR_HEIGHT) más el antepecho de la azotea */
  height: number
  /** color de la fachada (RGB hexadecimal) */
  color: number
  /** plantas sobre rasante, contando la baja (la azotea va encima) */
  floors: number
  /** posición en `buildings`: semilla de su interior */
  index: number
  /** marco del solar (ver buildingPlan.ts): dónde están sus fachadas y medianeras */
  frame: LotFrame
  /** la puerta del portal: centro del hueco sobre la fachada, mirando a la calle */
  portal: Spot
  /** el local de la planta baja y su escaparate (el del café es la fachada del café) */
  shop: { kind: ShopKind; door: Spot }
}

export interface Bench {
  x: number
  z: number
  /** hacia dónde mira quien se sienta: dirección (sin yaw, cos yaw) */
  yaw: number
}

export interface Tree {
  x: number
  z: number
  scale: number
}

export interface NavNode {
  id: number
  x: number
  z: number
  links: number[]
}

/** Un paso de peatones: su centro (en el eje de la calle) y si se cruza a lo largo de x (una calle norte-sur) o de z. */
export interface Crossing extends Vec2 {
  alongX: boolean
}

/** Un sitio donde alguien puede quedarse parado mirando hacia `yaw`. */
export interface Spot extends Vec2 {
  yaw: number
}

/** Algo alto que tapa la vista de la cámara (los bancos, árboles y farolas no cuentan). */
export interface Blocker {
  box: Box
  height: number
}

export interface CityLayout {
  buildings: Building[]
  blockers: Blocker[]
  benches: Bench[]
  trees: Tree[]
  /** farolas: el poste en (x, z) y el brazo hacia `yaw` (siempre hacia la calzada; ver lampHead en streetLights.ts) */
  lamps: Spot[]
  /** zona del parque (hierba) */
  park: Box
  /** todo lo que bloquea el paso */
  obstacles: Box[]
  nav: NavNode[]
  /** pasos de peatones: donde la red de aceras cruza una calle */
  crossings: Crossing[]
  /** junto a las fachadas, mirando a los escaparates */
  windows: Spot[]
  /** en las esquinas, esperando para cruzar */
  corners: Spot[]
  /** a lo largo de las aceras, para charlar */
  talk: Spot[]
  spawn: Spot
  /** la puerta del café: centro del hueco, sobre la fachada, y hacia dónde mira (hacia la calle) */
  storefront: Spot
}

/** Cuánto sobresale el módulo de la fachada del café del plano del muro, para que no se pise con él (m). */
export const STOREFRONT_OFFSET = 0.03

/** Radio del anillo de nodos alrededor de la fuente del parque. */
export const PARK_RING_RADIUS = 4.6
/** Franja (rad) a cada lado de las diagonales del parque que se deja sin árboles, para que se pueda pasar. */
const PARK_CLEAR_ANGLE = 0.16

const FACADE_COLORS = [0xc9b8a2, 0xb7a58f, 0xd7cdbd, 0xa89887, 0xc4a79a, 0xb2b7ad, 0xcfc2a0, 0x9fa6a8]

const BENCH_LENGTH = 1.6
const BENCH_DEPTH = 0.5

/** Un edificio a medio hacer: las puertas y el marco se ponen cuando se sabe cuál es el del café. */
type Lot = Pick<Building, 'box' | 'height' | 'color' | 'floors'> & { streetX: number; streetZ: number }

function buildBlock(cx: number, cz: number, rng: Rng, buildings: Lot[]) {
  // dos cortes (uno por eje) dividen la manzana en cuatro solares de distinto tamaño
  const splitX = cx + (rng() - 0.5) * 12
  const splitZ = cz + (rng() - 0.5) * 12
  const xs = [cx - BLOCK_HALF, splitX, cx + BLOCK_HALF]
  const zs = [cz - BLOCK_HALF, splitZ, cz + BLOCK_HALF]
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const box: Box = { minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] }
      // de 3 a 8 plantas, y una de cada cinco veces 3 más (con las mismas tiradas que cuando solo había alturas)
      const floors = 3 + Math.floor(rng() * 6) + (rng() < 0.2 ? 3 : 0)
      buildings.push({
        box,
        floors,
        height: buildingHeight(floors),
        color: FACADE_COLORS[Math.floor(rng() * FACADE_COLORS.length)],
        // todos los solares hacen esquina: estas son sus dos fachadas a la calle
        streetX: i === 0 ? -1 : 1,
        streetZ: j === 0 ? -1 : 1,
      })
    }
  }
}

/** Grafo de aceras: cada manzana tiene a su alrededor un anillo de 8 nodos (esquinas y mitades de cada lado),
 * y los anillos vecinos se unen por pasos de peatones. */
/** Nodos de acera por manzana en la red (los del parque van después). */
const RING_NODES = 8

function buildNav(): NavNode[] {
  const nodes: NavNode[] = []
  const indexOf = new Map<string, number>()
  const key = (bx: number, bz: number, k: number) => `${bx},${bz},${k}`
  // 8 puntos del anillo, en orden alrededor de la manzana
  const ring: [number, number][] = [
    [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
  ]
  BLOCK_CENTERS.forEach((cx, bx) => {
    BLOCK_CENTERS.forEach((cz, bz) => {
      ring.forEach(([dx, dz], k) => {
        const id = nodes.length
        nodes.push({ id, x: cx + dx * RING_WALK, z: cz + dz * RING_WALK, links: [] })
        indexOf.set(key(bx, bz, k), id)
      })
    })
  })
  const link = (a: number, b: number) => {
    nodes[a].links.push(b)
    nodes[b].links.push(a)
  }
  for (let bx = 0; bx < 3; bx++) {
    for (let bz = 0; bz < 3; bz++) {
      for (let k = 0; k < 8; k++) link(indexOf.get(key(bx, bz, k))!, indexOf.get(key(bx, bz, (k + 1) % 8))!)
      // pasos de peatones hacia el este y el sur, solo en las esquinas: cada uno une una esquina con la que tiene enfrente
      if (bx < 2) for (const [a, b] of [[2, 0], [4, 6]]) link(indexOf.get(key(bx, bz, a))!, indexOf.get(key(bx + 1, bz, b))!)
      if (bz < 2) for (const [a, b] of [[6, 0], [4, 2]]) link(indexOf.get(key(bx, bz, a))!, indexOf.get(key(bx, bz + 1, b))!)
    }
  }

  // Parque: un anillo de 8 nodos alrededor de la fuente (donde dan los bancos) unido por las diagonales a las 4 esquinas de su acera.
  // Los árboles del parque dejan libres esas diagonales (ver generateCity).
  const parkRing: number[] = []
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4
    const id = nodes.length
    nodes.push({ id, x: Math.sin(angle) * PARK_RING_RADIUS, z: Math.cos(angle) * PARK_RING_RADIUS, links: [] })
    parkRing.push(id)
  }
  for (let k = 0; k < 8; k++) link(parkRing[k], parkRing[(k + 1) % 8])
  // k impar = diagonales: 45° (+x,+z), 135° (+x,-z), 225° (-x,-z), 315° (-x,+z); las esquinas del anillo del parque, (bx 1, bz 1), son 4, 2, 0 y 6
  for (const [k, corner] of [[1, 4], [3, 2], [5, 0], [7, 6]]) link(parkRing[k], indexOf.get(key(1, 1, corner))!)
  return nodes
}

/** Los enlaces de la red que van de la acera de una manzana a la de otra: ahí se pintan los pasos de peatones. */
export function streetCrossings(nav: readonly NavNode[]): Crossing[] {
  const ringCount = BLOCK_CENTERS.length * BLOCK_CENTERS.length * RING_NODES
  const crossings: Crossing[] = []
  for (const node of nav.slice(0, ringCount)) {
    for (const otherId of node.links) {
      if (otherId < node.id || otherId >= ringCount) continue
      if (Math.floor(otherId / RING_NODES) === Math.floor(node.id / RING_NODES)) continue
      const other = nav[otherId]
      crossings.push({ x: (node.x + other.x) / 2, z: (node.z + other.z) / 2, alongX: Math.abs(other.x - node.x) > Math.abs(other.z - node.z) })
    }
  }
  return crossings
}

export function generateCity(seed = 20261018): CityLayout {
  const rng = makeRng(seed)
  const lots: Lot[] = []
  const benches: Bench[] = []
  const trees: Tree[] = []
  const lamps: Spot[] = []
  const windows: Spot[] = []
  const corners: Spot[] = []
  const talk: Spot[] = []

  const park = boxAt(0, 0, BLOCK_HALF * 2, BLOCK_HALF * 2)
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      if (cx === 0 && cz === 0) continue
      buildBlock(cx, cz, rng, lots)
    }
  }

  // Bancos y puntos de actividad en las aceras de todas las manzanas con edificios
  const faces: { dx: number; dz: number }[] = [{ dx: 0, dz: -1 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 }]
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      const isPark = cx === 0 && cz === 0
      for (const { dx, dz } of faces) {
        // posición sobre la acera: pegada a la fachada (banco) o por el centro de la acera (paseo)
        const along = (offset: number, distance: number): Vec2 => ({
          x: cx + dx * distance + dz * offset,
          z: cz + dz * distance + dx * offset,
        })
        // mira hacia la calle (fuera de la manzana)
        const outwardYaw = Math.atan2(dx, dz)
        const inwardYaw = outwardYaw + Math.PI
        if (!isPark && rng() < 0.55) {
          const p = along((rng() - 0.5) * 14, BENCH_DISTANCE)
          benches.push({ x: p.x, z: p.z, yaw: outwardYaw })
        }
        if (!isPark && rng() < 0.6) {
          const p = along((rng() - 0.5) * 16, WINDOW_DISTANCE)
          windows.push({ ...p, yaw: inwardYaw })
        }
        const mid = along(0, RING_WALK)
        talk.push({ ...mid, yaw: outwardYaw })
      }
      // esquinas, mirando hacia la esquina de enfrente
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          corners.push({ x: cx + sx * RING_WALK, z: cz + sz * RING_WALK, yaw: Math.atan2(sx, sz) })
        }
      }
    }
  }

  // Parque: fuente, bancos alrededor y árboles
  for (const [bx, bz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
    benches.push({ x: bx, z: bz, yaw: Math.atan2(-bx, -bz) })
  }
  for (let i = 0; i < 10; i++) {
    // el ángulo se repite hasta caer fuera de las franjas libres alrededor de ejes y diagonales (múltiplos de 45°)
    let angle = rng() * Math.PI * 2
    for (let tries = 0; tries < 20; tries++) {
      const rest = angle % (Math.PI / 4)
      if (Math.min(rest, Math.PI / 4 - rest) > PARK_CLEAR_ANGLE) break
      angle = rng() * Math.PI * 2
    }
    const radius = 8.5 + rng() * 5
    trees.push({ x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, scale: 0.9 + rng() * 0.5 })
  }
  // Farolas en el bordillo de cada lado de manzana, con el brazo hacia la calzada; y como mucho un árbol entre cada dos
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      for (const { dx, dz } of faces) {
        // `along` es la coordenada del mundo a lo largo de la acera (x en los lados norte y sur, z en los otros dos), así
        // las farolas de las dos aceras de una calle quedan desfasadas sin depender de hacia dónde mira cada lado
        const at = (along: number): Vec2 => ({
          x: cx + dx * CURB_DISTANCE + Math.abs(dz) * along,
          z: cz + dz * CURB_DISTANCE + Math.abs(dx) * along,
        })
        const offsets = dx + dz > 0 ? LAMP_OFFSETS.positive : LAMP_OFFSETS.negative
        const yaw = Math.atan2(-dz, dx)
        for (const offset of offsets) lamps.push({ ...at(offset), yaw })
        if (rng() < 0.75) {
          const p = at((offsets[0] + offsets[1]) / 2)
          trees.push({ x: p.x, z: p.z, scale: 0.8 + rng() * 0.4 })
        }
      }
    }
  }

  // El café: en el solar de la manzana sur del parque que da a la plaza y está más cerca del eje central.
  // La puerta queda en el centro de su fachada (los solares miden al menos 9 m, y el módulo de la fachada, unos 5).
  const cafeLot = lots
    .filter((lot) => lot.box.minZ === BLOCK_PITCH - BLOCK_HALF)
    .sort((a, b) => Math.abs((a.box.minX + a.box.maxX) / 2) - Math.abs((b.box.minX + b.box.maxX) / 2))[0]
  const storefront: Spot = { x: (cafeLot.box.minX + cafeLot.box.maxX) / 2, z: cafeLot.box.minZ - STOREFRONT_OFFSET, yaw: Math.PI }
  // nada se pone delante de la puerta: ni bancos, ni árboles, ni farolas, ni gente mirando escaparates
  const nearDoor = (x: number, z: number) => Math.abs(x - storefront.x) < 3.6 && z < storefront.z && z > storefront.z - 4.5
  const keepAway = <T extends Vec2>(items: T[]) => items.filter((item) => !nearDoor(item.x, item.z))
  benches.splice(0, benches.length, ...keepAway(benches))
  trees.splice(0, trees.length, ...keepAway(trees))
  lamps.splice(0, lamps.length, ...keepAway(lamps))
  windows.splice(0, windows.length, ...keepAway(windows))

  // portales y locales: el del café tiene el portal en la otra fachada (la del café es la de la calle en z)
  const buildings = lots.map(({ streetX, streetZ, ...lot }, index): Building => {
    const cafe = lot.box === cafeLot.box
    const frame = lotFrame(lot.box, streetX, streetZ, cafe)
    const doors = buildingDoors(frame, lot.floors)
    return { ...lot, index, frame, portal: doors.portal, shop: cafe ? { kind: 'cafe', door: storefront } : { kind: shopKindFor(index), door: doors.shop } }
  })
  // ni bancos ni gente mirando escaparates delante de un portal o de un local (las farolas y los árboles, en el bordillo, no estorban)
  const doorSpots = buildings.flatMap((building) => [building.portal, ...(building.shop.kind === 'cafe' ? [] : [building.shop.door])])
  const blocksDoor = (x: number, z: number) =>
    doorSpots.some((door) => {
      const outX = Math.sin(door.yaw)
      const outZ = Math.cos(door.yaw)
      const along = (x - door.x) * outZ - (z - door.z) * outX
      const out = (x - door.x) * outX + (z - door.z) * outZ
      return Math.abs(along) < 3.2 && out > -0.5 && out < 2.5
    })
  benches.splice(0, benches.length, ...benches.filter((bench) => !blocksDoor(bench.x, bench.z)))
  windows.splice(0, windows.length, ...windows.filter((spot) => !blocksDoor(spot.x, spot.z)))

  const nav = buildNav()
  const obstacles: Box[] = []
  for (const building of buildings) obstacles.push(building.box)
  for (const bench of benches) {
    // el banco ocupa su largo a lo largo de la fachada (o tangente al círculo del parque)
    const alongX = Math.abs(Math.cos(bench.yaw)) > 0.5
    obstacles.push(boxAt(bench.x, bench.z, alongX ? BENCH_LENGTH : BENCH_DEPTH, alongX ? BENCH_DEPTH : BENCH_LENGTH))
  }
  for (const tree of trees) obstacles.push(boxAt(tree.x, tree.z, 0.4, 0.4))
  for (const lamp of lamps) obstacles.push(boxAt(lamp.x, lamp.z, 0.5, 0.5))
  obstacles.push(boxAt(0, 0, 3.4, 3.4)) // fuente
  // límites del mundo: cuatro paredes más allá de la calle perimetral
  const wall = WORLD_HALF + 1
  obstacles.push(
    { minX: -wall - 1, maxX: wall + 1, minZ: -wall - 1, maxZ: -WORLD_HALF },
    { minX: -wall - 1, maxX: wall + 1, minZ: WORLD_HALF, maxZ: wall + 1 },
    { minX: -wall - 1, maxX: -WORLD_HALF, minZ: -wall - 1, maxZ: wall + 1 },
    { minX: WORLD_HALF, maxX: wall + 1, minZ: -wall - 1, maxZ: wall + 1 },
  )

  const blockers: Blocker[] = buildings.map(({ box, height }) => ({ box, height }))
  blockers.push(...obstacles.slice(-4).map((box) => ({ box, height: 100 })))

  return {
    buildings,
    blockers,
    benches,
    trees,
    lamps,
    park,
    obstacles,
    nav,
    crossings: streetCrossings(nav),
    windows,
    corners,
    talk,
    spawn: { x: 0, z: RING_WALK, yaw: Math.PI },
    storefront,
  }
}

/** Nodo del grafo más cercano a un punto. */
export function nearestNode(nav: readonly NavNode[], x: number, z: number): NavNode {
  let best = nav[0]
  let bestDistance = Infinity
  for (const node of nav) {
    const distance = (node.x - x) ** 2 + (node.z - z) ** 2
    if (distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

/** Camino más corto entre dos nodos (Dijkstra). Devuelve los nodos en orden, incluidos origen y destino. */
export function findPath(nav: readonly NavNode[], from: number, to: number): NavNode[] {
  if (from === to) return [nav[from]]
  const distance = new Array<number>(nav.length).fill(Infinity)
  const previous = new Array<number>(nav.length).fill(-1)
  const open = new Set<number>([from])
  distance[from] = 0
  while (open.size > 0) {
    let current = -1
    for (const id of open) if (current < 0 || distance[id] < distance[current]) current = id
    if (current === to) break
    open.delete(current)
    for (const next of nav[current].links) {
      const step = Math.hypot(nav[next].x - nav[current].x, nav[next].z - nav[current].z)
      if (distance[current] + step < distance[next]) {
        distance[next] = distance[current] + step
        previous[next] = current
        open.add(next)
      }
    }
  }
  if (previous[to] < 0) return []
  const path: NavNode[] = []
  for (let id = to; id >= 0; id = previous[id]) path.unshift(nav[id])
  return path
}
