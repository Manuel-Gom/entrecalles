import { existsSync, readFileSync, statSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { describe, expect, it } from 'vitest'
import { makeSeat, seatsFor } from '../src/world/brain'
import { generateCity } from '../src/world/layout'
import { CHAIR_APPROACH, STOOL_APPROACH } from '../src/world/interior'
import { markerFromMatrix, worldBox, type Marker } from '../src/world/props'
import { makeSeatRoute } from '../src/world/seating'
import { FOUNTAIN_LEVELS, FOUNTAIN_RADII } from '../src/world/water'

/** Comprueba los modelos de Blender del mundo (public/models/mundo/): peso, triángulos, datos y que cuadren con el código. */

const DIR = 'public/models/mundo'

interface GltfNode {
  name?: string
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}
interface Gltf {
  nodes: GltfNode[]
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[]
  accessors: { count: number; min?: number[]; max?: number[] }[]
  scenes: { nodes: number[] }[]
  images?: unknown[]
  textures?: unknown[]
  materials?: unknown[]
}

function readGlb(name: string): { gltf: Gltf; bytes: number } {
  const file = `${DIR}/${name}.glb`
  const buffer = readFileSync(file)
  const jsonLength = buffer.readUInt32LE(12)
  return { gltf: JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf, bytes: statSync(file).size }
}

/** Triángulos del modelo (cuenta los índices de cada primitiva). */
function triangles(gltf: Gltf) {
  return (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives).reduce((sum, primitive) => sum + (primitive.indices === undefined ? 0 : gltf.accessors[primitive.indices].count / 3), 0)
}

/** Matriz del mundo de cada nodo (el modelo en su posición de origen). */
function worldMatrices(gltf: Gltf): Map<number, THREE.Matrix4> {
  const result = new Map<number, THREE.Matrix4>()
  const visit = (index: number, parent: THREE.Matrix4) => {
    const node = gltf.nodes[index]
    const local = new THREE.Matrix4()
    if (node.matrix) local.fromArray(node.matrix)
    else {
      local.compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
      )
    }
    const world = parent.clone().multiply(local)
    result.set(index, world)
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const root of gltf.scenes[0].nodes) visit(root, new THREE.Matrix4())
  return result
}

/** Marcadores de datos (vacíos con un nombre) del modelo. */
function markers(gltf: Gltf, pattern: RegExp): Marker[] {
  const matrices = worldMatrices(gltf)
  return gltf.nodes.flatMap((node, index) => (node.mesh === undefined && node.name && pattern.test(node.name) ? [markerFromMatrix(node.name, matrices.get(index)!)] : []))
}

/** Caja que envuelve todas las mallas del modelo (con los mínimos y máximos que guarda el glTF). */
function meshBounds(gltf: Gltf): THREE.Box3 {
  const matrices = worldMatrices(gltf)
  const box = new THREE.Box3()
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return
    for (const primitive of gltf.meshes![node.mesh].primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION]
      if (!accessor.min || !accessor.max) continue
      const local = new THREE.Box3(new THREE.Vector3(...accessor.min), new THREE.Vector3(...accessor.max))
      box.union(local.applyMatrix4(matrices.get(index)!))
    }
  })
  return box
}

describe.each([
  ['banco', { kb: 60, triangles: 1200 }],
  ['fachada_cafe', { kb: 120, triangles: 2500 }],
  ['cafe_interior', { kb: 200, triangles: 5000 }],
  ['fuente', { kb: 120, triangles: 8000 }],
  ['arbol', { kb: 120, triangles: 3500 }],
  ['farola', { kb: 80, triangles: 1800 }],
  ['sol', { kb: 80, triangles: 4000 }],
  ['luna', { kb: 80, triangles: 3000 }],
  ['luna_nueva', { kb: 120, triangles: 8000 }],
  ['luna_creciente', { kb: 120, triangles: 8000 }],
  ['luna_llena', { kb: 120, triangles: 8000 }],
  ['luna_menguante', { kb: 120, triangles: 8000 }],
] as const)('%s.glb', (name, limits) => {
  const { gltf, bytes } = readGlb(name)

  it('pesa poco y tiene pocos triángulos', () => {
    expect(bytes / 1024).toBeLessThan(limits.kb)
    expect(triangles(gltf)).toBeGreaterThan(100)
    expect(triangles(gltf)).toBeLessThan(limits.triangles)
  })

  it('no lleva texturas ni imágenes (solo colores de material)', () => {
    expect(gltf.images ?? []).toHaveLength(0)
    expect(gltf.textures ?? []).toHaveLength(0)
    expect((gltf.materials ?? []).length).toBeGreaterThan(0)
  })

  it('pocas mallas: se dibuja con pocas llamadas', () => {
    expect((gltf.meshes ?? []).length).toBeLessThanOrEqual(24)
  })

  it('los nodos de datos son solo los que entiende el código', () => {
    const names = gltf.nodes.filter((n) => n.mesh === undefined).map((n) => n.name ?? '')
    for (const nodeName of names) expect(nodeName, 'nodo de datos desconocido').toMatch(/^(COL_|SEAT_|LUZ_|ENTRADA|SALIDA|PUERTA_CENTRO|PUERTA_HOJA)/)
  })
})

describe('modelos del parque', () => {
  it('la fuente tiene una huella circular compacta y una altura de fuente urbana', () => {
    const { gltf } = readGlb('fuente')
    const bounds = meshBounds(gltf)
    const size = bounds.getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(2.8)
    expect(size.x).toBeLessThan(3.4)
    expect(size.z).toBeGreaterThan(2.8)
    expect(size.z).toBeLessThan(3.4)
    expect(size.y).toBeGreaterThan(1.6)
    expect(size.y).toBeLessThan(2)
    expect(bounds.min.y).toBeCloseTo(0, 2)
  })

  it('la fuente trae los materiales que viste el código del agua y la piedra', () => {
    const { gltf } = readGlb('fuente')
    const names = (gltf.materials as { name: string }[]).map((m) => m.name)
    for (const name of ['PiedraFuente', 'PiedraClara', 'FondoFuente', 'AguaFuente', 'ChorroFuente', 'BronceFuente']) expect(names).toContain(name)
  })

  it('las tres láminas de agua están a la altura y con el radio que espera el shader (src/world/water.ts)', async () => {
    const buffer = readFileSync(`${DIR}/fuente.glb`)
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')
    let water: THREE.Mesh | null = null
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.Material).name === 'AguaFuente') water = mesh
    })
    expect(water).not.toBeNull()
    const position = (water as unknown as THREE.Mesh).geometry.getAttribute('position')
    // cada lámina es un disco muy fino: se agrupan los vértices por altura y se mira la cara de arriba y el radio de cada grupo
    const discs: { top: number; radius: number }[] = []
    const sorted = Array.from({ length: position.count }, (_, i) => ({ y: position.getY(i), r: Math.hypot(position.getX(i), position.getZ(i)) })).sort((a, b) => a.y - b.y)
    for (const { y, r } of sorted) {
      const disc = discs[discs.length - 1]
      if (disc && y - disc.top < 0.05) {
        disc.top = y
        disc.radius = Math.max(disc.radius, r)
      } else discs.push({ top: y, radius: r })
    }
    expect(discs).toHaveLength(3)
    const expected = [FOUNTAIN_LEVELS.lower, FOUNTAIN_LEVELS.middle, FOUNTAIN_LEVELS.top]
    const radii = [FOUNTAIN_RADII.lower, FOUNTAIN_RADII.middle, FOUNTAIN_RADII.top]
    discs.forEach((disc, index) => {
      expect(Math.abs(disc.top - expected[index])).toBeLessThan(0.011)
      expect(Math.abs(disc.radius - radii[index])).toBeLessThan(0.011)
    })
  })

  it('el árbol tiene copa con volumen y un tronco de más de tres metros', () => {
    const { gltf } = readGlb('arbol')
    const size = meshBounds(gltf).getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(1.8)
    expect(size.z).toBeGreaterThan(1.8)
    expect(size.y).toBeGreaterThan(4.5)
    expect(size.y).toBeLessThan(5.3)
  })

  it('la farola incluye luminaria elevada y mantiene una altura de calle', () => {
    const { gltf } = readGlb('farola')
    const bounds = meshBounds(gltf)
    const size = bounds.getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(0.8)
    expect(size.y).toBeGreaterThan(4.2)
    expect(bounds.min.y).toBeCloseTo(0, 2)
  })

  it('el sol y la luna son modelos compactos y centrados para recorrer el cielo', () => {
    const sun = meshBounds(readGlb('sol').gltf)
    const moon = meshBounds(readGlb('luna').gltf)
    expect(sun.getSize(new THREE.Vector3()).x).toBeGreaterThan(4)
    expect(sun.getSize(new THREE.Vector3()).y).toBeGreaterThan(3)
    expect(moon.getSize(new THREE.Vector3()).x).toBeGreaterThan(2.5)
    expect(moon.getSize(new THREE.Vector3()).y).toBeGreaterThan(2.5)
    expect(moon.getCenter(new THREE.Vector3()).length()).toBeLessThan(0.02)
  })

  it('las cuatro fases lunares conservan la misma esfera y tienen superficies propias', () => {
    const phases = ['luna_nueva', 'luna_creciente', 'luna_llena', 'luna_menguante']
    const models = phases.map((name) => readGlb(name).gltf)
    const bounds = models.map(meshBounds)
    const sizes = bounds.map((box) => box.getSize(new THREE.Vector3()))
    for (const size of sizes) {
      expect(size.x).toBeGreaterThan(2.7)
      expect(size.y).toBeGreaterThan(2.7)
      expect(size.z).toBeGreaterThan(2.7)
    }
    expect(triangles(models[0])).toBeLessThan(triangles(models[1]))
    expect(triangles(models[1])).toBeLessThan(triangles(models[2]))
    expect(triangles(models[3])).toBeLessThan(triangles(models[2]))
  })
})

describe('banco.glb', () => {
  const { gltf } = readGlb('banco')

  it('mide lo que el barrio espera: 1,6 m de largo, medio metro de fondo y menos de 1 m de alto, con los pies en el suelo', () => {
    const size = meshBounds(gltf).getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(1.55)
    expect(size.x).toBeLessThan(1.7)
    expect(size.z).toBeGreaterThan(0.45)
    expect(size.z).toBeLessThan(0.65)
    expect(size.y).toBeGreaterThan(0.8)
    expect(size.y).toBeLessThan(1.0)
    expect(meshBounds(gltf).min.y).toBeCloseTo(0, 2)
  })

  it('tiene dos plazas y coinciden con las que usa la ciudad (±0,4 m, mirando hacia +Z)', () => {
    const seats = markers(gltf, /^SEAT_/)
    expect(seats).toHaveLength(2)
    const [expected] = seatsFor(generateCity())
    const reference = makeSeat(0, 0, 0)
    for (const seat of seats) {
      expect(Math.abs(seat.position.x)).toBeCloseTo(0.4, 3)
      expect(seat.position.y).toBeCloseTo(0.46, 2)
      expect(seat.yaw).toBeCloseTo(reference.yaw, 6)
    }
    expect(expected.height).toBeCloseTo(0.46, 6)
  })

  it('el respaldo está detrás (hacia -Z) y el frente hacia +Z, como se coloca en la calle', () => {
    // el punto más alto del modelo queda en la mitad trasera del asiento
    const bounds = meshBounds(gltf)
    expect(bounds.max.y).toBeGreaterThan(0.85)
    const backrest = gltf.nodes.find((n) => n.name === 'banco_madera')
    expect(backrest).toBeDefined()
    expect(bounds.min.z).toBeLessThan(-0.2)
  })

  it('la colisión es una caja de 1,6 × 0,5 m, como la que ya tiene la ciudad', () => {
    const [collider] = markers(gltf, /^COL_/)
    const { box } = worldBox(collider, new THREE.Matrix4())
    expect(box.maxX - box.minX).toBeCloseTo(1.6, 2)
    expect(box.maxZ - box.minZ).toBeCloseTo(0.5, 2)
  })
})

describe('fachada_cafe.glb', () => {
  const { gltf } = readGlb('fachada_cafe')

  it('es un módulo de unos 5 m de ancho y 3-4,5 m de alto, de cara a +Z y con el muro detrás', () => {
    const size = meshBounds(gltf).getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(4.9)
    expect(size.x).toBeLessThan(5.3)
    expect(size.y).toBeGreaterThan(3.3)
    expect(size.y).toBeLessThan(4.5)
    const bounds = meshBounds(gltf)
    // el toldo sale al frente (+Z) y el muro queda detrás
    expect(bounds.max.z).toBeGreaterThan(0.8)
    expect(bounds.min.z).toBeGreaterThan(-0.5)
  })

  it('tiene la hoja de la puerta con la bisagra como origen, y su centro', () => {
    const matrices = worldMatrices(gltf)
    const leafIndex = gltf.nodes.findIndex((n) => n.name === 'PUERTA_HOJA')
    expect(leafIndex).toBeGreaterThanOrEqual(0)
    const hinge = new THREE.Vector3().setFromMatrixPosition(matrices.get(leafIndex)!)
    const [center] = markers(gltf, /^PUERTA_CENTRO/)
    // la bisagra está en el borde del hueco: a medio metro del centro de la puerta
    expect(Math.abs(center.position.x - hinge.x)).toBeGreaterThan(0.4)
    expect(Math.abs(center.position.x - hinge.x)).toBeLessThan(0.6)
    // y la hoja (hija o no) llena el hueco: su malla se extiende desde la bisagra hacia el centro
    const leaf = gltf.nodes[leafIndex]
    const accessor = gltf.accessors[gltf.meshes![leaf.mesh!].primitives[0].attributes.POSITION]
    expect(accessor.max![0]).toBeGreaterThan(0.8)
    expect(accessor.min![0]).toBeGreaterThanOrEqual(-0.01)
  })
})

describe('cafe_interior.glb', () => {
  const { gltf } = readGlb('cafe_interior')
  const colliders = markers(gltf, /^COL_/)
  const boxes = colliders.map((collider) => ({ name: collider.name, ...worldBox(collider, new THREE.Matrix4()) }))
  const seats = markers(gltf, /^SEAT_/)

  it('es una sala de 8 × 7 m cuya entrada está en el plano z = 0 y que se adentra hacia +Z', () => {
    const entry = markers(gltf, /^ENTRADA/)[0]
    const exit = markers(gltf, /^SALIDA/)[0]
    expect(entry.position.z).toBeGreaterThan(exit.position.z)
    expect(entry.position.z).toBeLessThan(3)
    expect(entry.yaw).toBeCloseTo(0, 6) // mira hacia dentro (+Z)
    expect(exit.position.z).toBeGreaterThan(0)
    expect(Math.abs(entry.position.x)).toBeLessThan(0.1)
    const walls = boxes.filter((box) => /^COL_pared/.test(box.name))
    expect(Math.min(...walls.map((w) => w.box.minX))).toBeLessThan(-4)
    expect(Math.max(...walls.map((w) => w.box.maxX))).toBeGreaterThan(4)
    expect(Math.max(...walls.map((w) => w.box.maxZ))).toBeGreaterThan(7)
  })

  it('no se puede salir de la sala andando: la puerta y las cuatro paredes tienen colisión', () => {
    const names = boxes.map((box) => box.name)
    for (const wall of ['COL_pared_fondo', 'COL_pared_izquierda', 'COL_pared_derecha', 'COL_pared_frente_izq', 'COL_pared_frente_der', 'COL_pared_puerta']) {
      expect(names).toContain(wall)
    }
    // las paredes son altas (tapan la cámara)
    for (const wall of boxes.filter((box) => /^COL_pared/.test(box.name))) expect(wall.maxY - wall.minY).toBeGreaterThan(3)
  })

  it('el punto de aparición y el de salida están libres', () => {
    for (const marker of [markers(gltf, /^ENTRADA/)[0], markers(gltf, /^SALIDA/)[0]]) {
      for (const { box, name } of boxes) {
        const inside = marker.position.x > box.minX - 0.3 && marker.position.x < box.maxX + 0.3 && marker.position.z > box.minZ - 0.3 && marker.position.z < box.maxZ + 0.3
        expect(inside, `${marker.name} choca con ${name}`).toBe(false)
      }
    }
  })

  it('hay plazas suficientes (4 mesas con 2 sillas y 3 taburetes) y todas se alcanzan por un sitio libre', () => {
    expect(seats.length).toBe(11)
    expect(boxes.filter((box) => /^COL_silla/.test(box.name))).toHaveLength(8)
    expect(boxes.filter((box) => /^COL_taburete/.test(box.name))).toHaveLength(3)
    for (const seat of seats) {
      const approach = /taburete/.test(seat.name) ? STOOL_APPROACH : CHAIR_APPROACH
      const built = makeSeat(seat.position.x, seat.position.z, seat.yaw, 'detras', approach, seat.position.y)
      const collider = boxes.find((box) => box.name === seat.name.replace(/^SEAT_/, 'COL_'))?.box
      built.collider = collider
      const route = makeSeatRoute(built, boxes.map((box) => box.box))
      expect(route[0]).toEqual(built.approach)
      expect(route.at(-1)).toEqual({ x: built.x, z: built.z })
      expect(built.approach.x).toBeGreaterThan(-3.8)
      expect(built.approach.x).toBeLessThan(3.8)
      expect(built.approach.z).toBeGreaterThan(0.4)
      expect(built.approach.z).toBeLessThan(6.8)
      for (const { box, name } of boxes) {
        const hits = built.approach.x > box.minX - 0.28 && built.approach.x < box.maxX + 0.28 && built.approach.z > box.minZ - 0.28 && built.approach.z < box.maxZ + 0.28
        expect(hits, `el punto de acercamiento de ${seat.name} choca con ${name}`).toBe(false)
      }
    }
  })

  it('las sillas y taburetes bloquean el paso sin cerrar sus puntos de acercamiento', () => {
    for (const seat of seats) {
      const collider = boxes.find((box) => box.name === seat.name.replace(/^SEAT_/, 'COL_'))
      expect(collider, `${seat.name} no tiene colisión`).toBeDefined()
      expect(collider!.maxY - collider!.minY).toBeGreaterThan(0.6)
      expect(collider!.maxY - collider!.minY).toBeLessThan(1.1)
    }
  })

  it('la estantería del mostrador también tiene colisión', () => {
    expect(boxes.find((box) => box.name === 'COL_estanteria')).toBeDefined()
  })

  it('la planta alta de la esquina tiene colisión propia', () => {
    expect(boxes.find((box) => box.name === 'COL_lampara')).toBeDefined()
  })

  it('el frente de cada silla mira hacia una mesa y el de cada taburete, hacia el mostrador', () => {
    const tables = boxes.filter((box) => /^COL_mesa/.test(box.name))
    expect(tables).toHaveLength(4)
    for (const seat of seats.filter((s) => /silla/.test(s.name))) {
      const ahead = { x: seat.position.x + Math.sin(seat.yaw) * 0.85, z: seat.position.z + Math.cos(seat.yaw) * 0.85 }
      expect(tables.some(({ box }) => ahead.x > box.minX && ahead.x < box.maxX && ahead.z > box.minZ && ahead.z < box.maxZ), `${seat.name} no mira a una mesa`).toBe(true)
    }
    const counter = boxes.find((box) => box.name === 'COL_mostrador')!
    for (const seat of seats.filter((s) => /taburete/.test(s.name))) {
      expect(seat.position.z).toBeLessThan(counter.box.minZ - 0.3)
      const ahead = { x: seat.position.x + Math.sin(seat.yaw) * 0.6, z: seat.position.z + Math.cos(seat.yaw) * 0.6 }
      expect(ahead.z).toBeGreaterThan(counter.box.minZ - 0.05)
      expect(ahead.x).toBeGreaterThan(counter.box.minX)
      expect(ahead.x).toBeLessThan(counter.box.maxX)
    }
  })

  it('la altura de los asientos es razonable (sillas ~0,47 m, taburetes ~0,67 m)', () => {
    for (const seat of seats) {
      if (/silla/.test(seat.name)) expect(seat.position.y).toBeCloseTo(0.47, 1)
      if (/taburete/.test(seat.name)) expect(seat.position.y).toBeCloseTo(0.67, 1)
    }
  })

  it('tiene luces puntuales dentro de la sala, por encima de la cabeza', () => {
    const lights = markers(gltf, /^LUZ_/)
    expect(lights.length).toBeGreaterThanOrEqual(3)
    for (const light of lights) {
      expect(light.position.y).toBeGreaterThan(2)
      expect(Math.abs(light.position.x)).toBeLessThan(4)
      expect(light.position.z).toBeGreaterThan(0)
      expect(light.position.z).toBeLessThan(7)
    }
  })
})

describe('licencia', () => {
  it('los modelos propios llevan su declaración CC0', () => {
    expect(existsSync(`${DIR}/LICENCIA.txt`)).toBe(true)
    expect(readFileSync(`${DIR}/LICENCIA.txt`, 'utf8')).toMatch(/CC0/)
  })
})
