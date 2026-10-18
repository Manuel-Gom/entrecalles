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

/* Medidas del barrio, en metros. Manzanas de 30 × 30 separadas por calles de 10 (6 de calzada y 2 de acera a cada lado). */
export const BLOCK_PITCH = 40
export const BLOCK_HALF = 15
export const SIDEWALK = 2.5
/** Mitad del lado de la manzana más su acera: el borde exterior de la acera. */
export const RING_OUTER = BLOCK_HALF + SIDEWALK
/** Línea por la que se anda: separada de la fachada para dejar sitio a los bancos. */
export const RING_WALK = BLOCK_HALF + 1.7
/** Distancia al centro de la manzana de los bancos (pegados a la fachada), de los escaparates y de árboles y farolas (en el bordillo). */
const BENCH_DISTANCE = BLOCK_HALF + 0.3
const WINDOW_DISTANCE = BLOCK_HALF + 0.85
const CURB_DISTANCE = BLOCK_HALF + SIDEWALK - 0.2
export const BLOCK_CENTERS = [-BLOCK_PITCH, 0, BLOCK_PITCH] as const
/** Ejes de las calles, entre manzanas y en el perímetro. */
export const STREET_CENTERS = [-BLOCK_PITCH - 20, -BLOCK_PITCH / 2, BLOCK_PITCH / 2, BLOCK_PITCH + 20] as const
/** Mitad del lado del mundo (hasta el borde exterior de las calles perimetrales). */
export const WORLD_HALF = BLOCK_PITCH + BLOCK_HALF + 10
export const SIDEWALK_HEIGHT = 0.02

export interface Building {
  box: Box
  height: number
  /** color de la fachada (RGB hexadecimal) */
  color: number
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
  lamps: Vec2[]
  /** zona del parque (hierba) */
  park: Box
  /** todo lo que bloquea el paso */
  obstacles: Box[]
  nav: NavNode[]
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

function buildBlock(cx: number, cz: number, rng: Rng, buildings: Building[]) {
  // dos cortes (uno por eje) dividen la manzana en cuatro solares de distinto tamaño
  const splitX = cx + (rng() - 0.5) * 12
  const splitZ = cz + (rng() - 0.5) * 12
  const xs = [cx - BLOCK_HALF, splitX, cx + BLOCK_HALF]
  const zs = [cz - BLOCK_HALF, splitZ, cz + BLOCK_HALF]
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const box: Box = { minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] }
      buildings.push({
        box,
        height: 8 + Math.floor(rng() * 6) * 3 + (rng() < 0.2 ? 9 : 0),
        color: FACADE_COLORS[Math.floor(rng() * FACADE_COLORS.length)],
      })
    }
  }
}

/** Grafo de aceras: cada manzana tiene a su alrededor un anillo de 8 nodos (esquinas y mitades de cada lado),
 * y los anillos vecinos se unen por pasos de peatones. */
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
      // pasos de peatones hacia el este y el sur: esquina, mitad, esquina
      if (bx < 2) for (const [a, b] of [[2, 6], [3, 7], [4, 0]]) link(indexOf.get(key(bx, bz, a))!, indexOf.get(key(bx + 1, bz, b))!)
      if (bz < 2) for (const [a, b] of [[6, 0], [5, 1], [4, 2]]) link(indexOf.get(key(bx, bz, a))!, indexOf.get(key(bx, bz + 1, b))!)
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

export function generateCity(seed = 20261018): CityLayout {
  const rng = makeRng(seed)
  const buildings: Building[] = []
  const benches: Bench[] = []
  const trees: Tree[] = []
  const lamps: Vec2[] = []
  const windows: Spot[] = []
  const corners: Spot[] = []
  const talk: Spot[] = []

  const park = boxAt(0, 0, BLOCK_HALF * 2, BLOCK_HALF * 2)
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      if (cx === 0 && cz === 0) continue
      buildBlock(cx, cz, rng, buildings)
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
  // Árboles en el bordillo de las aceras de cada manzana, con farolas entre ellos
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      for (const { dx, dz } of faces) {
        const at = (offset: number): Vec2 => ({
          x: cx + dx * CURB_DISTANCE + dz * offset,
          z: cz + dz * CURB_DISTANCE + dx * offset,
        })
        for (const offset of [-10, -3.5, 3.5, 10]) {
          if (rng() < 0.4) {
            const p = at(offset)
            trees.push({ x: p.x, z: p.z, scale: 0.8 + rng() * 0.4 })
          }
        }
        lamps.push(at(-6.5), at(6.5))
      }
    }
  }

  // El café: en el solar de la manzana sur del parque que da a la plaza y está más cerca del eje central.
  // La puerta queda en el centro de su fachada (los solares miden al menos 9 m, y el módulo de la fachada, unos 5).
  const cafeLot = buildings
    .filter((building) => building.box.minZ === BLOCK_PITCH - BLOCK_HALF)
    .sort((a, b) => Math.abs((a.box.minX + a.box.maxX) / 2) - Math.abs((b.box.minX + b.box.maxX) / 2))[0]
  const storefront: Spot = { x: (cafeLot.box.minX + cafeLot.box.maxX) / 2, z: cafeLot.box.minZ - STOREFRONT_OFFSET, yaw: Math.PI }
  // nada se pone delante de la puerta: ni bancos, ni árboles, ni farolas, ni gente mirando escaparates
  const nearDoor = (x: number, z: number) => Math.abs(x - storefront.x) < 3.6 && z < storefront.z && z > storefront.z - 4.5
  const keepAway = <T extends Vec2>(items: T[]) => items.filter((item) => !nearDoor(item.x, item.z))
  benches.splice(0, benches.length, ...keepAway(benches))
  trees.splice(0, trees.length, ...keepAway(trees))
  lamps.splice(0, lamps.length, ...keepAway(lamps))
  windows.splice(0, windows.length, ...keepAway(windows))

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
    nav: buildNav(),
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
