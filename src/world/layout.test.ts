import { describe, expect, it } from 'vitest'
import type { Box } from './collision'
import { BLOCK_CENTERS, PARK_RING_RADIUS, RING_WALK, findPath, generateCity, makeRng, nearestNode, type NavNode } from './layout'

const city = generateCity()

/** Distancia de un punto a una caja (0 si está dentro). */
function distanceToBox(x: number, z: number, box: Box) {
  const nx = Math.min(Math.max(x, box.minX), box.maxX)
  const nz = Math.min(Math.max(z, box.minZ), box.maxZ)
  return Math.hypot(x - nx, z - nz)
}
const clearance = (x: number, z: number, skip: readonly Box[] = []) =>
  Math.min(...city.obstacles.filter((box) => !skip.includes(box)).map((box) => distanceToBox(x, z, box)))

describe('makeRng', () => {
  it('es determinista y devuelve valores en [0, 1)', () => {
    const a = makeRng(5)
    const b = makeRng(5)
    for (let i = 0; i < 50; i++) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(makeRng(5)()).not.toBe(makeRng(6)())
  })
})

describe('generateCity', () => {
  it('es determinista: la misma semilla da el mismo barrio', () => {
    expect(generateCity(3)).toEqual(generateCity(3))
    expect(generateCity(3).buildings).not.toEqual(generateCity(4).buildings)
  })

  it('tiene 8 manzanas con 4 edificios y el parque en el centro', () => {
    expect(city.buildings).toHaveLength(8 * 4)
    expect(BLOCK_CENTERS).toHaveLength(3)
    for (const { box } of city.buildings) {
      expect(box.maxX).toBeGreaterThan(box.minX)
      expect(box.maxZ).toBeGreaterThan(box.minZ)
      // ningún edificio invade el parque
      expect(box.minX >= city.park.maxX || box.maxX <= city.park.minX || box.minZ >= city.park.maxZ || box.maxZ <= city.park.minZ).toBe(true)
    }
  })

  it('los edificios de una manzana se reparten la manzana entera, sin solaparse', () => {
    const buildings = city.buildings
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i].box
        const b = buildings[j].box
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
        const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
        expect(overlapX > 1e-9 && overlapZ > 1e-9).toBe(false)
      }
    }
  })

  it('el punto de salida está libre', () => {
    expect(clearance(city.spawn.x, city.spawn.z)).toBeGreaterThan(0.6)
  })

  it('el mundo está cerrado por paredes: no se puede salir andando', () => {
    for (const [x, z] of [[0, 100], [0, -100], [100, 0], [-100, 0]]) {
      expect(city.obstacles.some((box) => x >= box.minX - 40 && x <= box.maxX + 40 && z >= box.minZ - 40 && z <= box.maxZ + 40)).toBe(true)
    }
    const maxReach = Math.max(...city.obstacles.map((box) => Math.max(box.maxX, box.maxZ)))
    expect(maxReach).toBeGreaterThan(65)
  })

  it('los bancos no se solapan con árboles, farolas ni entre sí', () => {
    const benchBoxes = city.obstacles.slice(city.buildings.length, city.buildings.length + city.benches.length)
    expect(benchBoxes).toHaveLength(city.benches.length)
    benchBoxes.forEach((bench, i) => {
      const others = city.obstacles.filter((box) => box !== bench && !city.buildings.some((b) => b.box === box))
      for (const other of others.slice(0, others.length - 5)) {
        const overlap = Math.min(bench.maxX, other.maxX) > Math.max(bench.minX, other.minX) + 1e-9 && Math.min(bench.maxZ, other.maxZ) > Math.max(bench.minZ, other.minZ) + 1e-9
        expect(overlap, `banco ${i} solapa con otro obstáculo`).toBe(false)
      }
    })
  })
})

describe('red de aceras', () => {
  const nodes = city.nav

  it('hay 8 nodos por manzana (72), 8 más en el parque y los enlaces son recíprocos', () => {
    expect(nodes).toHaveLength(80)
    for (const node of nodes) {
      for (const link of node.links) expect(nodes[link].links).toContain(node.id)
      expect(node.links.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('todos los nodos están conectados entre sí', () => {
    const seen = new Set<number>([0])
    const queue = [0]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const next of nodes[id].links) if (!seen.has(next)) seen.add(next) && queue.push(next)
    }
    expect(seen.size).toBe(nodes.length)
  })

  it('caminar por cualquier enlace no atraviesa ni roza ningún obstáculo', () => {
    for (const node of nodes) {
      for (const linkId of node.links) {
        const other = nodes[linkId]
        const length = Math.hypot(other.x - node.x, other.z - node.z)
        const steps = Math.ceil(length / 0.25)
        for (let i = 0; i <= steps; i++) {
          const x = node.x + ((other.x - node.x) * i) / steps
          const z = node.z + ((other.z - node.z) * i) / steps
          expect(clearance(x, z), `nodo ${node.id} → ${linkId} en (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeGreaterThan(0.3)
        }
      }
    }
  })

  it('los nodos del parque rodean la fuente y se unen a las esquinas por las diagonales', () => {
    const park = nodes.slice(72)
    expect(park).toHaveLength(8)
    for (const node of park) expect(Math.hypot(node.x, node.z)).toBeCloseTo(PARK_RING_RADIUS, 6)
    // los 4 nodos diagonales tienen un enlace largo hacia una esquina de la acera del parque
    const diagonal = park.filter((node) => node.links.some((id) => id < 72))
    expect(diagonal).toHaveLength(4)
    for (const node of diagonal) {
      const corner = nodes[node.links.find((id) => id < 72)!]
      expect(Math.abs(corner.x)).toBeCloseTo(RING_WALK, 6)
      expect(Math.abs(corner.z)).toBeCloseTo(RING_WALK, 6)
      expect(Math.sign(corner.x)).toBe(Math.sign(node.x))
      expect(Math.sign(corner.z)).toBe(Math.sign(node.z))
    }
  })

  it('desde la acera se llega andando a cada banco del parque', () => {
    const from = nearestNode(nodes, RING_WALK + 40, RING_WALK + 40).id // una esquina lejana
    for (const bench of city.benches.filter((b) => Math.abs(b.x) < 10 && Math.abs(b.z) < 10)) {
      const front = { x: bench.x + Math.sin(bench.yaw) * 1.4, z: bench.z + Math.cos(bench.yaw) * 1.4 }
      expect(findPath(nodes, from, nearestNode(nodes, front.x, front.z).id).length).toBeGreaterThan(1)
    }
  })

  it('los nodos de las aceras están sobre la línea de la acera', () => {
    for (const node of nodes.slice(0, 72)) {
      const onRing = BLOCK_CENTERS.some((cx) => BLOCK_CENTERS.some((cz) => Math.abs(Math.abs(node.x - cx) - RING_WALK) < 1e-9 || Math.abs(Math.abs(node.z - cz) - RING_WALK) < 1e-9))
      expect(onRing).toBe(true)
    }
  })
})

describe('puntos de actividad', () => {
  it('los sitios para charlar, esperar y mirar escaparates están libres', () => {
    for (const spot of [...city.corners, ...city.talk]) {
      expect(clearance(spot.x - 0.65 * Math.cos(spot.yaw), spot.z + 0.65 * Math.sin(spot.yaw)), 'charla A').toBeGreaterThan(0.28)
      expect(clearance(spot.x + 0.65 * Math.cos(spot.yaw), spot.z - 0.65 * Math.sin(spot.yaw)), 'charla B').toBeGreaterThan(0.28)
    }
    for (const spot of city.windows) expect(clearance(spot.x, spot.z)).toBeGreaterThan(0.25)
  })

  it('quien mira un escaparate queda frente a la fachada, a menos de 1 m', () => {
    for (const spot of city.windows) {
      const ahead = { x: spot.x + Math.sin(spot.yaw) * 1.2, z: spot.z + Math.cos(spot.yaw) * 1.2 }
      expect(city.buildings.some(({ box }) => distanceToBox(ahead.x, ahead.z, box) === 0)).toBe(true)
    }
  })
})

describe('findPath y nearestNode', () => {
  const nodes = city.nav

  it('nearestNode devuelve el nodo más cercano', () => {
    const target = nodes[17]
    expect(nearestNode(nodes, target.x + 0.2, target.z - 0.1).id).toBe(17)
  })

  it('el camino empieza y acaba donde se pide, y cada paso es un enlace', () => {
    const path = findPath(nodes, 0, 71)
    expect(path[0].id).toBe(0)
    expect(path.at(-1)?.id).toBe(71)
    for (let i = 1; i < path.length; i++) expect(path[i - 1].links).toContain(path[i].id)
  })

  it('es el más corto: no es más largo que ir por otro enlace directo', () => {
    const a = nodes[0]
    const b = nodes[a.links[0]]
    expect(findPath(nodes, a.id, b.id)).toHaveLength(2)
  })

  it('de un nodo a sí mismo es un camino de un solo nodo', () => {
    expect(findPath(nodes, 5, 5).map((n) => n.id)).toEqual([5])
  })

  it('si no hay camino devuelve una lista vacía', () => {
    const isolated: NavNode[] = [
      { id: 0, x: 0, z: 0, links: [] },
      { id: 1, x: 5, z: 0, links: [] },
    ]
    expect(findPath(isolated, 0, 1)).toEqual([])
  })
})
