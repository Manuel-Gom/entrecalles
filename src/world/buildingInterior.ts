import * as THREE from 'three'
import { makeSeat, type Seat } from './brain'
import {
  SLAB, WALL_HEIGHT, heightAt as planHeight, inBox, levelOf, levelY, roofY, type BuildingPlan, type ElevatorPlan, type PlanDoor, type PlanLight, type PlanRoom, type PlanWall,
} from './buildingPlan'
import type { Box } from './collision'
import { InstancedProp, swingTowards } from './doors'
import { CHAIR_APPROACH } from './interior'
import { FLOOR_COLORS, type InteriorMaterials, type InteriorSurface } from './interiorMaterials'
import type { Blocker } from './layout'
import { placementMatrix, worldBox, type Prop } from './props'

/** Los modelos de Blender ya cargados, por nombre. */
export type PropLibrary = ReadonlyMap<string, Prop>

/** Lo que hace sonar un edificio. */
export type BuildingSound = 'puerta' | 'ascensor' | 'llegada'

/** A cuántos metros se abre sola una puerta. */
const DOOR_REACH = 1.6
/** Cuánto tarda la cabina en recorrer una planta (s). */
const ELEVATOR_SECONDS_PER_FLOOR = 1.3
const COMMON_PAINT = 0xe6dccb
const CEILING = 0xf3f1ec
const WALL_TOP = 0xd8d2c8
const SKIRTING = 0x6b4a30
const THRESHOLD = 0xe8e2d6
/** Altura sin tope para la cámara: las fachadas por dentro no la dejan salir. */
const NO_LIMIT = 1e4

/* ---------- geometría hecha por código ---------- */

/** Acumula cuadriláteros con color por vértice; las coordenadas de textura son metros (las usa el shader del acabado). */
class QuadBuilder {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []
  private readonly colors: number[] = []
  private readonly indices: number[] = []
  private readonly color = new THREE.Color()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()

  get empty() {
    return this.indices.length === 0
  }

  /** Cuadrilátero p0 p1 p2 p3 (en orden alrededor) que mira hacia `normal`; el sentido se corrige solo. */
  quad(points: number[][], normal: number[], hex: number, uv: number[][]) {
    this.a.set(points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2])
    this.b.set(points[3][0] - points[0][0], points[3][1] - points[0][1], points[3][2] - points[0][2])
    const facing = this.a.cross(this.b).dot(new THREE.Vector3(normal[0], normal[1], normal[2]))
    const order = facing >= 0 ? [0, 1, 2, 3] : [0, 3, 2, 1]
    this.color.set(hex)
    const start = this.positions.length / 3
    for (const i of order) {
      this.positions.push(points[i][0], points[i][1], points[i][2])
      this.normals.push(normal[0], normal[1], normal[2])
      this.uvs.push(uv[i][0], uv[i][1])
      this.colors.push(this.color.r, this.color.g, this.color.b)
    }
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }

  /** Rectángulo horizontal entre dos esquinas, mirando arriba (`up`) o abajo. */
  flat(box: Box, y: number, hex: number, up = true) {
    const p = [[box.minX, y, box.minZ], [box.maxX, y, box.minZ], [box.maxX, y, box.maxZ], [box.minX, y, box.maxZ]]
    this.quad(p, [0, up ? 1 : -1, 0], hex, p.map((c) => [c[0], c[2]]))
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.setIndex(this.indices)
    geometry.computeBoundingSphere()
    return geometry
  }
}

class SurfaceBuilders {
  private readonly builders = new Map<InteriorSurface, QuadBuilder>()

  get(surface: InteriorSurface): QuadBuilder {
    let builder = this.builders.get(surface)
    if (!builder) {
      builder = new QuadBuilder()
      this.builders.set(surface, builder)
    }
    return builder
  }

  build(materials: InteriorMaterials): THREE.Group {
    const group = new THREE.Group()
    for (const [surface, builder] of this.builders) {
      if (builder.empty) continue
      const mesh = new THREE.Mesh(builder.build(), materials[surface])
      mesh.receiveShadow = true
      mesh.castShadow = false
      group.add(mesh)
    }
    return group
  }
}

/** Muebles estáticos de una planta fusionados por material: una llamada de dibujo por material, no una por mueble. */
class MaterialBatches {
  private readonly batches = new Map<string, { material: THREE.Material; positions: number[]; normals: number[]; indices: number[] }>()
  private readonly matrix = new THREE.Matrix4()
  private readonly normalMatrix = new THREE.Matrix3()
  private readonly v = new THREE.Vector3()

  add(prop: Prop, placement: THREE.Matrix4) {
    prop.root.updateMatrixWorld(true)
    const underDoor = (object: THREE.Object3D) => {
      for (let node: THREE.Object3D | null = object; node && node !== prop.root; node = node.parent) if (prop.doors.includes(node)) return true
      return false
    }
    prop.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || underDoor(mesh)) return
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const position = mesh.geometry.getAttribute('position')
      const normal = mesh.geometry.getAttribute('normal')
      if (!position || !normal) return
      const key = material.name || material.uuid
      let batch = this.batches.get(key)
      if (!batch) {
        batch = { material, positions: [], normals: [], indices: [] }
        this.batches.set(key, batch)
      }
      this.matrix.multiplyMatrices(placement, mesh.matrixWorld)
      this.normalMatrix.getNormalMatrix(this.matrix)
      const start = batch.positions.length / 3
      for (let i = 0; i < position.count; i++) {
        this.v.fromBufferAttribute(position, i).applyMatrix4(this.matrix)
        batch.positions.push(this.v.x, this.v.y, this.v.z)
        this.v.fromBufferAttribute(normal, i).applyMatrix3(this.normalMatrix).normalize()
        batch.normals.push(this.v.x, this.v.y, this.v.z)
      }
      const index = mesh.geometry.getIndex()
      if (index) for (let i = 0; i < index.count; i++) batch.indices.push(start + index.getX(i))
      else for (let i = 0; i < position.count; i++) batch.indices.push(start + i)
    })
  }

  build(): THREE.Group {
    const group = new THREE.Group()
    for (const batch of this.batches.values()) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3))
      geometry.setIndex(batch.indices)
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, batch.material)
      mesh.castShadow = false
      mesh.receiveShadow = true
      group.add(mesh)
    }
    return group
  }
}

/* ---------- muros ---------- */

interface Piece {
  a0: number
  a1: number
  y0: number
  y1: number
}

/** Trozos de un muro alrededor de sus huecos (a lo largo de su eje y en altura sobre el suelo de la planta). */
function wallPieces(wall: PlanWall): Piece[] {
  const a0 = wall.alongX ? wall.box.minX : wall.box.minZ
  const a1 = wall.alongX ? wall.box.maxX : wall.box.maxZ
  const openings = wall.openings
    .map((o) => ({ ...o, from: Math.max(a0, o.from), to: Math.min(a1, o.to) }))
    .filter((o) => o.to - o.from > 0.01)
    .sort((a, b) => a.from - b.from)
  const pieces: Piece[] = []
  let cursor = a0
  for (const o of openings) {
    if (o.from > cursor) pieces.push({ a0: cursor, a1: o.from, y0: 0, y1: wall.height })
    if (o.bottom > 0) pieces.push({ a0: o.from, a1: o.to, y0: 0, y1: Math.min(o.bottom, wall.height) })
    if (o.top < wall.height) pieces.push({ a0: o.from, a1: o.to, y0: o.top, y1: wall.height })
    cursor = Math.max(cursor, o.to)
  }
  if (a1 > cursor) pieces.push({ a0: cursor, a1, y0: 0, y1: wall.height })
  return pieces
}

/** Huellas de un muro por las que no se puede pasar: todo menos los huecos de puerta. */
function wallSolids(wall: PlanWall): Box[] {
  const solids: Box[] = []
  for (const piece of wallPieces(wall)) {
    if (piece.y0 > 0.5) continue // dintel: por debajo se pasa
    solids.push(wall.alongX ? { ...wall.box, minX: piece.a0, maxX: piece.a1 } : { ...wall.box, minZ: piece.a0, maxZ: piece.a1 })
  }
  return solids
}

function roomAt(rooms: readonly PlanRoom[], x: number, z: number): PlanRoom | null {
  for (const room of rooms) if (inBox(room.box, x, z)) return room
  return null
}

/** Dibuja un muro: las dos caras (pintadas o alicatadas según la estancia de cada lado), el canto de arriba, los dinteles, las jambas y el rodapié. */
function addWall(out: SurfaceBuilders, wall: PlanWall, rooms: readonly PlanRoom[], buildingBox: Box) {
  const base = levelY(wall.level)
  const t0 = wall.alongX ? wall.box.minZ : wall.box.minX
  const t1 = wall.alongX ? wall.box.maxZ : wall.box.maxX
  const at = (a: number, y: number, t: number) => (wall.alongX ? [a, base + y, t] : [t, base + y, a])
  const normalTo = (sign: number) => (wall.alongX ? [0, 0, sign] : [sign, 0, 0])
  const openingEdges = new Set<number>()
  for (const o of wall.openings) {
    openingEdges.add(Math.round(o.from * 1000))
    openingEdges.add(Math.round(o.to * 1000))
  }
  // cortes a lo largo donde cambia la estancia de un lado
  const cuts = new Set<number>()
  for (const room of rooms) for (const c of wall.alongX ? [room.box.minX, room.box.maxX] : [room.box.minZ, room.box.maxZ]) cuts.add(c)
  const surface = wall.kind === 'barandilla' ? 'metal' : 'pintura'

  for (const piece of wallPieces(wall)) {
    for (const [t, sign] of [[t0, -1], [t1, 1]] as const) {
      const marks = [piece.a0, ...[...cuts].filter((c) => c > piece.a0 + 0.01 && c < piece.a1 - 0.01).sort((a, b) => a - b), piece.a1]
      for (let i = 0; i < marks.length - 1; i++) {
        const s0 = marks[i]
        const s1 = marks[i + 1]
        const mid = (s0 + s1) / 2
        const probe = wall.alongX ? { x: mid, z: t + sign * 0.06 } : { x: t + sign * 0.06, z: mid }
        // las caras que dan fuera del edificio (o al vecino) no se ven: no se dibujan
        if (!inBox(buildingBox, probe.x, probe.z, -0.001)) continue
        const room = roomAt(rooms, probe.x, probe.z)
        if (room?.kind === 'cerrado') continue
        const tiled = surface === 'pintura' && room?.tiles === true
        const hex = surface === 'metal' ? 0x2e3033 : (room?.paint ?? COMMON_PAINT)
        const face = [at(s0, piece.y0, t), at(s1, piece.y0, t), at(s1, piece.y1, t), at(s0, piece.y1, t)]
        out.get(tiled ? 'azulejo' : surface).quad(face, normalTo(sign), hex, face.map((p, k) => [k === 0 || k === 3 ? s0 : s1, p[1] - base]))
        // rodapié de madera en las paredes pintadas
        if (surface === 'pintura' && !tiled && piece.y0 === 0 && room && room.floor) {
          const tt = t + sign * 0.012
          const strip = [at(s0, 0, tt), at(s1, 0, tt), at(s1, 0.08, tt), at(s0, 0.08, tt)]
          out.get('madera').quad(strip, normalTo(sign), SKIRTING, strip.map(() => [0, 0]))
          const top = [at(s0, 0.08, t), at(s1, 0.08, t), at(s1, 0.08, tt), at(s0, 0.08, tt)]
          out.get('madera').quad(top, [0, 1, 0], SKIRTING, top.map(() => [0, 0]))
        }
      }
    }
    // canto de arriba (o el alféizar bajo una ventana) y la cara de abajo de los dinteles
    const topFace = [at(piece.a0, piece.y1, t0), at(piece.a1, piece.y1, t0), at(piece.a1, piece.y1, t1), at(piece.a0, piece.y1, t1)]
    out.get(surface).quad(topFace, [0, 1, 0], surface === 'metal' ? 0x2e3033 : WALL_TOP, topFace.map((p) => [p[0], p[2]]))
    if (piece.y0 > 0) {
      const bottom = [at(piece.a0, piece.y0, t0), at(piece.a1, piece.y0, t0), at(piece.a1, piece.y0, t1), at(piece.a0, piece.y0, t1)]
      out.get(surface).quad(bottom, [0, -1, 0], WALL_TOP, bottom.map((p) => [p[0], p[2]]))
    }
    // jambas: solo donde el trozo da a un hueco
    for (const [a, sign] of [[piece.a0, -1], [piece.a1, 1]] as const) {
      if (!openingEdges.has(Math.round(a * 1000))) continue
      const jamb = [at(a, piece.y0, t0), at(a, piece.y0, t1), at(a, piece.y1, t1), at(a, piece.y1, t0)]
      out.get(surface).quad(jamb, wall.alongX ? [sign, 0, 0] : [0, 0, sign], WALL_TOP, jamb.map((p) => [wall.alongX ? p[2] : p[0], p[1] - base]))
    }
  }
}

/* ---------- ascensor ---------- */

type ElevatorState = 'parado' | 'cerrando' | 'moviendo'

/** La cabina y las puertas de cada planta. Se llama sola al acercarse a la puerta de otra planta. */
class Elevator {
  readonly plan: ElevatorPlan
  level = 0
  y: number
  private target = 0
  private state: ElevatorState = 'parado'
  readonly doors: InstancedProp | null
  readonly cabin: THREE.Object3D | null

  constructor(plan: ElevatorPlan, props: PropLibrary) {
    this.plan = plan
    this.y = levelY(0)
    const doorProp = props.get('ascensor_puerta')
    this.doors = doorProp
      ? new InstancedProp(doorProp, Array.from({ length: plan.stops }, (_, i) => placementMatrix(plan.door.x, levelY(i), plan.door.z, plan.door.yaw)), false)
      : null
    const cabinProp = props.get('ascensor')
    this.cabin = cabinProp ? cabinProp.root.clone() : null
    if (this.cabin) this.cabin.rotation.y = plan.cabinSpot.yaw
    this.place()
  }

  private place() {
    this.cabin?.position.set(this.plan.cabinSpot.x, this.y, this.plan.cabinSpot.z)
  }

  get moving() {
    return this.state !== 'parado'
  }

  /** ¿Está alguien (en x, z, y) dentro de la cabina? */
  contains(x: number, z: number, y: number) {
    return inBox(this.plan.cabin, x, z) && Math.abs(y - this.y) < 0.8
  }

  /** ¿Se puede pasar ahora por la puerta de la planta `level`? */
  passable(level: number) {
    return this.state === 'parado' && this.level === level && (this.doors?.openness(level) ?? 1) > 0.7
  }

  /** Manda la cabina a una planta (con quien vaya dentro). */
  go(level: number) {
    if (this.state !== 'parado' || level === this.level || level < 0 || level >= this.plan.stops) return false
    this.target = level
    this.state = 'cerrando'
    return true
  }

  update(dt: number, x: number, z: number, y: number, sound: (s: BuildingSound) => void) {
    const inside = this.contains(x, z, y)
    const playerLevel = Math.round((y - levelY(0)) / 3)
    const near = (level: number) => Math.abs(y - levelY(level)) < 0.6 && Math.hypot(x - this.plan.door.x, z - this.plan.door.z) < DOOR_REACH
    // se llama sola: alguien espera en otra planta y la cabina está vacía
    if (this.state === 'parado' && !inside && playerLevel !== this.level && playerLevel < this.plan.stops && near(playerLevel)) {
      this.target = playerLevel
      this.state = 'cerrando'
    }
    for (let i = 0; i < this.plan.stops; i++) {
      const want = this.state === 'parado' && i === this.level && (inside || near(i)) ? 1 : 0
      const now = this.doors?.openness(i) ?? want
      this.doors?.setOpen(i, swingTowards(now, want, dt, 0.8))
    }
    if (this.state === 'cerrando' && (this.doors?.openness(this.level) ?? 0) <= 0.001) {
      this.state = 'moviendo'
      if (inside) sound('ascensor')
    }
    if (this.state === 'moviendo') {
      const goal = levelY(this.target)
      const step = (3 / ELEVATOR_SECONDS_PER_FLOOR) * dt
      this.y += Math.max(-step, Math.min(step, goal - this.y))
      if (Math.abs(goal - this.y) < 1e-4) {
        this.y = goal
        this.level = this.target
        this.state = 'parado'
        if (inside) sound('llegada')
      }
      this.place()
    }
  }

  dispose() {
    this.doors?.dispose()
    this.cabin?.removeFromParent()
  }
}

/* ---------- el interior ---------- */

interface DoorSlot {
  door: PlanDoor
  prop: InstancedProp
  index: number
  open: number
}

interface Level {
  obstacles: Box[]
  blockers: Blocker[]
  seats: Seat[]
  lights: PlanLight[]
  rooms: PlanRoom[]
  shell: THREE.Group | null
  ceiling: THREE.Group | null
  furniture: THREE.Group | null
  doors: DoorSlot[]
  doorProps: InstancedProp[]
}

/** Modelos cuyas plazas se alcanzan por detrás (sillas con mesa delante). */
const BEHIND = /^(comedor|mesa_cocina|escritorio|sillon_peluqueria)$/

/**
 * Un edificio por dentro, colocado en su sitio real (por las ventanas se ve la calle). Se monta al acercarse a él: las
 * colisiones, las plazas y las luces de todas las plantas enseguida, y las mallas solo de la planta en la que se está y
 * de las de al lado. Las de arriba no se dibujan (como en un corte), así la cámara ve al personaje desde arriba.
 */
export class BuildingInterior {
  readonly plan: BuildingPlan
  readonly group = new THREE.Group()
  readonly elevator: Elevator | null
  private readonly levels: Level[] = []
  private readonly props: PropLibrary
  private readonly materials: InteriorMaterials
  private view = { level: 0, inside: false }
  private readonly obstacleCache = new Map<string, Box[]>()

  constructor(plan: BuildingPlan, props: PropLibrary, materials: InteriorMaterials) {
    this.plan = plan
    this.props = props
    this.materials = materials
    for (let level = 0; level <= plan.floors; level++) this.levels.push(this.levelData(level))
    this.elevator = plan.elevator ? new Elevator(plan.elevator, props) : null
    if (this.elevator?.doors) this.group.add(this.elevator.doors.group)
    if (this.elevator?.cabin) this.group.add(this.elevator.cabin)
    this.setView(0, false)
  }

  /** Colisiones, plazas y luces de una planta (sin mallas). */
  private levelData(level: number): Level {
    const { plan } = this
    const walls = plan.walls.filter((w) => w.level === level)
    const obstacles: Box[] = [...plan.core]
    const blockers: Blocker[] = []
    const top = levelY(level) + WALL_HEIGHT
    for (const wall of walls) {
      const solids = wallSolids(wall)
      obstacles.push(...solids)
      if (wall.kind === 'exterior') blockers.push(...solids.map((box) => ({ box, height: NO_LIMIT })))
      else if (wall.kind === 'interior') blockers.push(...solids.map((box) => ({ box, height: top })))
    }
    const seats: Seat[] = []
    for (const item of plan.items) {
      if (item.level !== level) continue
      const prop = this.props.get(item.model)
      if (!prop) continue
      const placement = placementMatrix(item.x, item.y, item.z, item.yaw)
      const colliders = prop.colliders.map((collider) => worldBox(collider, placement).box)
      obstacles.push(...colliders)
      for (const marker of prop.seats) {
        const p = marker.position.clone().applyMatrix4(placement)
        const behind = BEHIND.test(item.model)
        const seat = makeSeat(p.x, p.z, item.yaw + marker.yaw, behind ? 'detras' : 'delante', behind ? CHAIR_APPROACH : 0.75, marker.position.y)
        seat.collider = colliders.find((box) => inBox(box, p.x, p.z)) ?? colliders[0]
        seats.push(seat)
      }
    }
    return {
      obstacles,
      blockers,
      seats,
      lights: plan.lights.filter((l) => l.level === level),
      rooms: plan.rooms.filter((r) => r.level === level),
      shell: null,
      ceiling: null,
      furniture: null,
      doors: [],
      doorProps: [],
    }
  }

  /** Suelos, muros y bordes de los huecos de una planta; y aparte el techo (la cara de abajo del forjado de encima). */
  private buildShell(level: number) {
    const data = this.levels[level]
    const { plan } = this
    const y = levelY(level)
    const out = new SurfaceBuilders()
    for (const room of data.rooms) {
      if (!room.floor) continue
      // cada piso con su tono de parqué
      const tone = room.floor === 'parquet' && room.flat >= 0 ? 0.88 + ((room.flat * 37) % 10) / 40 : 1
      out.get(room.floor).flat(room.box, y, new THREE.Color(FLOOR_COLORS[room.floor]).multiplyScalar(tone).getHex())
    }
    for (const wall of plan.walls) {
      if (wall.level !== level) continue
      if (wall.visible) addWall(out, wall, data.rooms, plan.box)
      // umbral bajo cada puerta
      for (const o of wall.openings) {
        if (o.bottom > 0.01) continue
        const box = wall.alongX ? { ...wall.box, minX: o.from, maxX: o.to } : { ...wall.box, minZ: o.from, maxZ: o.to }
        out.get('terrazo').flat(box, y + 0.003, THRESHOLD)
      }
    }
    // cantos de los huecos del forjado (escalera, ascensor, patio)
    for (const hole of plan.holes[level] ?? []) {
      const b = hole
      const sides: [number[][], number[]][] = [
        [[[b.minX, y - SLAB, b.minZ], [b.maxX, y - SLAB, b.minZ], [b.maxX, y, b.minZ], [b.minX, y, b.minZ]], [0, 0, 1]],
        [[[b.minX, y - SLAB, b.maxZ], [b.maxX, y - SLAB, b.maxZ], [b.maxX, y, b.maxZ], [b.minX, y, b.maxZ]], [0, 0, -1]],
        [[[b.minX, y - SLAB, b.minZ], [b.minX, y - SLAB, b.maxZ], [b.minX, y, b.maxZ], [b.minX, y, b.minZ]], [1, 0, 0]],
        [[[b.maxX, y - SLAB, b.minZ], [b.maxX, y - SLAB, b.maxZ], [b.maxX, y, b.maxZ], [b.maxX, y, b.minZ]], [-1, 0, 0]],
      ]
      for (const [points, normal] of sides) out.get('pintura').quad(points, normal, CEILING, points.map((p) => [p[0] + p[2], p[1]]))
    }
    data.shell = out.build(this.materials)
    this.group.add(data.shell)
    const ceiling = new SurfaceBuilders()
    for (const slab of plan.slabs[level + 1] ?? []) ceiling.get('pintura').flat(slab, levelY(level + 1) - SLAB, CEILING, false)
    data.ceiling = ceiling.build(this.materials)
    this.group.add(data.ceiling)
  }

  /** Muebles, ventanas, escalera y puertas de una planta. */
  private buildFurniture(level: number) {
    const data = this.levels[level]
    const batches = new MaterialBatches()
    for (const item of this.plan.items) {
      if (item.level !== level) continue
      const prop = this.props.get(item.model)
      if (prop) batches.add(prop, placementMatrix(item.x, item.y, item.z, item.yaw))
    }
    data.furniture = batches.build()
    // las hojas de las puertas, aparte, para que cada una se abra sola
    const byModel = new Map<string, PlanDoor[]>()
    for (const door of this.plan.doors) {
      if (door.level !== level) continue
      byModel.set(door.model, [...(byModel.get(door.model) ?? []), door])
    }
    for (const [model, doors] of byModel) {
      const prop = this.props.get(model)
      if (!prop) continue
      // el marco va con la hoja, en la misma copia instanciada
      const instanced = new InstancedProp(prop, doors.map((d) => placementMatrix(d.x, d.y, d.z, d.yaw)), false)
      data.doorProps.push(instanced)
      data.furniture.add(instanced.group)
      doors.forEach((door, index) => data.doors.push({ door, prop: instanced, index, open: 0 }))
    }
    this.group.add(data.furniture)
  }

  private releaseFurniture(level: number) {
    const data = this.levels[level]
    if (!data.furniture) return
    for (const prop of data.doorProps) prop.dispose()
    data.doorProps.length = 0
    data.doors.length = 0
    data.furniture.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) mesh.geometry.dispose()
    })
    data.furniture.removeFromParent()
    data.furniture = null
  }

  /** Qué se ve: la planta actual y la de abajo (con muebles), las de más abajo solo con sus muros, y nada por encima. */
  setView(level: number, inside: boolean) {
    this.view = { level, inside }
    const top = inside ? level : 0
    for (let i = 0; i < this.levels.length; i++) {
      const data = this.levels[i]
      const shellWanted = i <= top
      const furnitureWanted = inside ? i === level || i === level - 1 : i === 0
      if (shellWanted && !data.shell) this.buildShell(i)
      // los muebles de las plantas de al lado se montan ya (para subir o bajar sin esperas) y los lejanos se sueltan
      if ((furnitureWanted || (inside && Math.abs(i - level) <= 1)) && !data.furniture) this.buildFurniture(i)
      if (data.furniture && Math.abs(i - level) > 2) this.releaseFurniture(i)
      if (data.shell) data.shell.visible = shellWanted
      if (data.ceiling) data.ceiling.visible = inside ? i < level : i === 0
      if (data.furniture) data.furniture.visible = furnitureWanted
    }
    if (this.elevator?.cabin) this.elevator.cabin.visible = this.elevator.y <= levelY(top) + 1
    if (this.elevator?.doors) this.elevator.doors.group.visible = true
  }

  get viewLevel() {
    return this.view.level
  }

  levelAt(y: number) {
    return levelOf(this.plan, y)
  }

  /** Altura del suelo en (x, z) para quien está a `y` (en la escalera, en la cabina del ascensor o en una planta). */
  heightAt(x: number, z: number, y: number): number {
    if (this.elevator && inBox(this.elevator.plan.cabin, x, z)) return this.elevator.y
    return planHeight(this.plan, x, z, y)
  }

  /** Lo que no se puede atravesar a la altura `y`. */
  obstaclesFor(y: number): readonly Box[] {
    const level = this.levelAt(y)
    const ground = y < levelY(0) + 1
    const roof = y > roofY(this.plan.floors) - 0.6
    const lift = this.elevator && level < this.elevator.plan.stops && !this.elevator.passable(level)
    const key = `${level}|${ground}|${roof}|${lift}`
    let list = this.obstacleCache.get(key)
    if (!list) {
      list = [...this.levels[level].obstacles]
      if (ground) list.push(this.plan.groundBlock)
      if (roof) list.push(this.plan.roofBlock)
      if (lift && this.elevator) list.push(this.elevator.plan.gap)
      this.obstacleCache.set(key, list)
    }
    return list
  }

  blockersFor(y: number): readonly Blocker[] {
    return this.levels[this.levelAt(y)].blockers
  }

  seatsFor(y: number): readonly Seat[] {
    return this.levels[this.levelAt(y)].seats
  }

  lightsFor(y: number): readonly PlanLight[] {
    return this.levels[this.levelAt(y)].lights
  }

  /** Qué se pisa: parqué, baldosa (o terrazo) o la azotea. */
  surfaceAt(x: number, z: number, y: number): 'madera' | 'baldosa' | 'acera' {
    const room = roomAt(this.levels[this.levelAt(y)].rooms, x, z)
    if (!room || room.floor === 'parquet') return room ? 'madera' : 'baldosa'
    return room.floor === 'cubierta' ? 'acera' : 'baldosa'
  }

  /** Abre las puertas cerca de quien anda por la planta y mueve el ascensor. */
  update(dt: number, x: number, z: number, y: number, sound: (s: BuildingSound) => void) {
    const level = this.levelAt(y)
    for (const [i, data] of this.levels.entries()) {
      for (const slot of data.doors) {
        const near = i === level && Math.hypot(x - slot.door.x, z - slot.door.z) < DOOR_REACH
        const next = swingTowards(slot.open, near ? 1 : 0, dt)
        if (slot.open === 0 && next > 0 && slot.door.announce) sound('puerta')
        slot.open = next
        slot.prop.setOpen(slot.index, next)
      }
    }
    if (this.elevator) {
      this.elevator.update(dt, x, z, y, sound)
      if (this.elevator.cabin) this.elevator.cabin.visible = this.elevator.y <= levelY(this.view.inside ? this.view.level : 0) + 1
    }
  }

  dispose() {
    for (let i = 0; i < this.levels.length; i++) {
      this.releaseFurniture(i)
      const data = this.levels[i]
      for (const group of [data.shell, data.ceiling]) {
        group?.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (mesh.isMesh) mesh.geometry.dispose()
        })
        group?.removeFromParent()
      }
    }
    this.elevator?.dispose()
    this.group.removeFromParent()
  }
}
