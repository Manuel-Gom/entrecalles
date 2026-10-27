import * as THREE from 'three'
import type { Prop } from './props'

/** Hasta dónde gira una hoja abierta del todo (rad) y cuánto tarda en abrirse (s). */
export const DOOR_OPEN_ANGLE = 1.5
const DOOR_SECONDS = 0.55
/** Lo que tarda la mano en llegar a la hoja desde que se alarga el brazo (s); hasta entonces la puerta no se mueve. */
export const CONTACT_SECONDS = 0.22
/** Lo que sigue abierta una puerta después de que nadie la pida (s), y lo que tarda en cerrarse sola. */
const HOLD_SECONDS = 0.8
const CLOSE_SECONDS = 0.9
/** Lo que tarda el brazo en alargarse y en recogerse (s). */
const PUSH_IN_SECONDS = 0.22
const PUSH_OUT_SECONDS = 0.3

/** Lleva `current` (0-1) hacia `target` a ritmo de puerta. */
export function swingTowards(current: number, target: number, dt: number, seconds = DOOR_SECONDS): number {
  const step = dt / seconds
  return current + Math.max(-step, Math.min(step, target - current))
}

/** Arranca y frena suave: lo que se ve de una puerta abierta `amount` (0-1). */
export const easeDoor = (amount: number) => amount * amount * (3 - 2 * amount)

/** Quien anda cerca de una puerta: posición y velocidad (m/s). */
export interface Walker {
  x: number
  z: number
  vx: number
  vz: number
}

/** Una puerta en el mundo: el centro del hueco, hacia dónde mira su frente (unitario) y medio ancho del hueco. */
export interface DoorFrame {
  x: number
  z: number
  nx: number
  nz: number
  halfWidth: number
}

/** Dónde está alguien respecto a una puerta y si va hacia ella. */
export interface Approach {
  /** distancia al plano de la puerta, positiva por delante (el frente del modelo) */
  across: number
  /** desvío a lo largo de la puerta desde el centro del hueco */
  along: number
  /** velocidad hacia el plano de la puerta (m/s; negativa si se aleja) */
  toward: number
  /** está en el umbral (la puerta no se cierra con alguien aquí) */
  doorway: boolean
  /** viene de frente hacia la puerta y está a tiro: pide que se abra */
  coming: boolean
}

/**
 * Si alguien pide abrir una puerta: solo quien está en el umbral o viene de frente hacia el hueco (no quien pasa por la
 * acera, está quieto delante o se aleja). Cuanto más rápido viene, antes se abre: `reach` es el alcance andando muy
 * despacio y cada m/s lo alarga 0,35 m.
 */
export function approach(frame: DoorFrame, walker: Walker, reach: number): Approach {
  const dx = walker.x - frame.x
  const dz = walker.z - frame.z
  const across = dx * frame.nx + dz * frame.nz
  const along = dx * frame.nz - dz * frame.nx
  const toward = -(walker.vx * frame.nx + walker.vz * frame.nz) * (across >= 0 ? 1 : -1)
  const doorway = Math.abs(along) < frame.halfWidth + 0.15 && Math.abs(across) < 0.45
  const speed = Math.hypot(walker.vx, walker.vz)
  const coming = toward > 0.3 && Math.abs(along) < frame.halfWidth + 0.35 && Math.abs(across) < reach + speed * 0.35
  return { across, along, toward, doorway, coming }
}

/**
 * Una puerta de hoja que se abre empujándola: quien llega alarga el brazo, la hoja no se mueve hasta que la mano la
 * toca (`CONTACT_SECONDS`) y entonces gira hacia el lado contrario al suyo, más deprisa cuanto más rápido viene. Sigue
 * abierta mientras alguien la pida o esté en el umbral y un poco más, y luego se cierra despacio.
 */
export class DoorOpener {
  /** apertura (0-1, a ritmo lineal: se dibuja con `easeDoor`) */
  open = 0
  /** hacia dónde gira la hoja: +1 hacia atrás (empuja quien viene por delante), -1 hacia delante */
  side: 1 | -1 = 1
  /** quién la empuja (índice en la lista de `update`, -1 nadie), con qué mano y cuánto alarga el brazo (0-1) */
  pusher = -1
  hand: 'l' | 'r' = 'r'
  push = 0
  private hold = 0
  private reaching = -1
  private seconds = DOOR_SECONDS

  /** ¿Está quieta y cerrada (no hace falta avanzarla)? */
  get idle() {
    return this.open === 0 && this.push === 0 && this.reaching < 0 && this.hold <= 0
  }

  /**
   * Avanza la puerta; devuelve true si empieza a abrirse (para el sonido). `locked`: cerrada con llave por delante (un
   * local cerrado): desde fuera no se abre, desde dentro sí.
   */
  update(dt: number, frame: DoorFrame, walkers: readonly Walker[], reach: number, locked = false): boolean {
    let pusherSide = 0
    for (let i = 0; i < walkers.length; i++) {
      const a = approach(frame, walkers[i], reach)
      if (i === this.pusher) pusherSide = a.across * this.side
      if (!a.doorway && !a.coming) continue
      if (locked && a.across > 0 && this.open === 0) continue
      this.hold = HOLD_SECONDS
      if (this.reaching >= 0 || this.open > 0) continue
      // empieza a empujarla: gira lejos de quien llega, con la mano del lado del tirador (el canto sin bisagra)
      this.reaching = a.doorway ? CONTACT_SECONDS : 0
      this.pusher = i
      this.side = a.across >= 0 ? 1 : -1
      this.hand = a.across >= 0 ? 'r' : 'l'
      pusherSide = Math.abs(a.across)
      const speed = Math.max(a.toward, 0.3)
      const atContact = Math.max(0, Math.abs(a.across) - speed * CONTACT_SECONDS)
      this.seconds = Math.min(DOOR_SECONDS, Math.max(0.15, (0.8 * atContact) / speed))
    }
    if (this.reaching >= 0) this.reaching += dt
    const want = this.hold > 0 && (this.reaching >= CONTACT_SECONDS || this.open > 0)
    const before = this.open
    this.open = swingTowards(this.open, want ? 1 : 0, dt, want ? this.seconds : CLOSE_SECONDS)
    this.hold = Math.max(0, this.hold - dt)
    // el brazo se alarga mientras empuja: hasta que la hoja está casi abierta o ya ha pasado al otro lado
    const pushing = this.pusher >= 0 && this.reaching >= 0 && this.open < 0.85 && pusherSide > 0.05
    this.push = swingTowards(this.push, pushing ? 1 : 0, dt, pushing ? PUSH_IN_SECONDS : PUSH_OUT_SECONDS)
    if (this.open === 0 && this.hold <= 0) {
      this.reaching = -1
      this.pusher = -1
    }
    return before === 0 && this.open > 0
  }
}

interface Leaf {
  mesh: THREE.InstancedMesh
  /** de la colocación al eje de la hoja (la bisagra, o su sitio cerrada) y de ahí a la malla */
  pre: THREE.Matrix4
  post: THREE.Matrix4
  slide: number
}

/** La hoja con bisagra de un modelo: su eje (colocación en el modelo) y su caja vista desde el eje. */
interface Hinge {
  pre: THREE.Matrix4
  box: THREE.Box3
}

/**
 * Un modelo dibujado muchas veces con pocas llamadas (una malla instanciada por cada malla del modelo), con las hojas de
 * sus puertas aparte para que cada copia se pueda abrir por su cuenta. Las geometrías y los materiales son del modelo:
 * al liberar esto no se tocan.
 */
export class InstancedProp {
  readonly group = new THREE.Group()
  readonly count: number
  private readonly leaves: Leaf[] = []
  /** las mallas que no se mueven, con su posición dentro del modelo */
  private readonly fixed: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = []
  private readonly placements: THREE.Matrix4[]
  private readonly open: Float32Array
  private readonly sides: Int8Array
  private readonly shown: Uint8Array
  private hinge: Hinge | null = null
  private readonly matrix = new THREE.Matrix4()
  private readonly motion = new THREE.Matrix4()
  private static readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(prop: Prop, placements: readonly THREE.Matrix4[], shadows = true) {
    this.placements = placements.map((m) => m.clone())
    this.count = placements.length
    this.open = new Float32Array(this.count)
    this.sides = new Int8Array(this.count).fill(1)
    this.shown = new Uint8Array(this.count).fill(1)
    prop.root.updateMatrixWorld(true)
    const doorOf = (object: THREE.Object3D): THREE.Object3D | null => {
      for (let node: THREE.Object3D | null = object; node && node !== prop.root; node = node.parent) if (prop.doors.includes(node)) return node
      return null
    }
    const local = new THREE.Matrix4()
    prop.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || this.count === 0) return
      const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, this.count)
      instanced.castShadow = shadows
      instanced.receiveShadow = true
      instanced.frustumCulled = false
      instanced.name = mesh.name
      this.group.add(instanced)
      const door = doorOf(mesh)
      if (!door) {
        this.fixed.push({ mesh: instanced, local: mesh.matrixWorld.clone() })
        this.placements.forEach((placement, i) => instanced.setMatrixAt(i, local.multiplyMatrices(placement, mesh.matrixWorld)))
        instanced.instanceMatrix.needsUpdate = true
        return
      }
      // una hoja corredera se desliza lo que mide; hacia la izquierda (_I) o la derecha (_D) del modelo
      let slide = 0
      if (/^PUERTA_CORREDERA/.test(door.name)) {
        const size = new THREE.Box3().setFromObject(door).getSize(new THREE.Vector3())
        slide = size.x * 0.95 * (/_I/.test(door.name) ? -1 : 1)
      }
      if (slide === 0 && !this.hinge) {
        const box = new THREE.Box3().setFromObject(door).applyMatrix4(door.matrixWorld.clone().invert())
        this.hinge = { pre: door.matrixWorld.clone(), box }
      }
      const leaf: Leaf = { mesh: instanced, pre: door.matrixWorld.clone(), post: door.matrixWorld.clone().invert().multiply(mesh.matrixWorld), slide }
      this.leaves.push(leaf)
      for (let i = 0; i < this.count; i++) this.writeLeaf(leaf, i)
      instanced.instanceMatrix.needsUpdate = true
    })
  }

  private writeLeaf(leaf: Leaf, index: number) {
    if (!this.shown[index]) {
      leaf.mesh.setMatrixAt(index, InstancedProp.hidden)
      return
    }
    const amount = easeDoor(this.open[index])
    if (leaf.slide !== 0) this.motion.makeTranslation(leaf.slide * amount, 0, 0)
    else this.motion.makeRotationY(DOOR_OPEN_ANGLE * amount * this.sides[index])
    this.matrix.multiplyMatrices(this.placements[index], leaf.pre).multiply(this.motion).multiply(leaf.post)
    leaf.mesh.setMatrixAt(index, this.matrix)
  }

  /** Cuánto está abierta la puerta de la copia `index` (0 cerrada, 1 abierta). */
  openness(index: number): number {
    return this.open[index]
  }

  /** Abre la copia `index` (0-1); una hoja con bisagra gira hacia atrás (`side` 1) o hacia delante (-1). */
  setOpen(index: number, amount: number, side: 1 | -1 = this.sides[index] as 1 | -1) {
    // cerrada o abierta del todo se guarda exacta: con la tolerancia, una hoja podía quedarse en 0,00005 y ya no contaba
    // como cerrada (y al volver a abrirse no sonaba)
    const same = this.open[index] === amount || (amount !== 0 && amount !== 1 && Math.abs(this.open[index] - amount) < 1e-4)
    if (same && this.sides[index] === side) return
    this.open[index] = amount
    this.sides[index] = side
    for (const leaf of this.leaves) {
      this.writeLeaf(leaf, index)
      leaf.mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** La puerta de hoja de la copia `index` en el mundo (null si el modelo no tiene hoja con bisagra). */
  doorFrame(index: number): DoorFrame | null {
    const hinge = this.hinge
    if (!hinge) return null
    const { box } = hinge
    const center = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, 0).applyMatrix4(hinge.pre).applyMatrix4(this.placements[index])
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.placements[index])
    return { x: center.x, z: center.z, nx: normal.x, nz: normal.z, halfWidth: (box.max.x - box.min.x) / 2 }
  }

  /** Dónde apoya la mano quien empuja la hoja de la copia `index`: cerca del canto sin bisagra, en su cara. */
  pushPoint(index: number, out: THREE.Vector3): THREE.Vector3 {
    const hinge = this.hinge
    if (!hinge) return out.set(0, 0, 0).applyMatrix4(this.placements[index])
    const { box } = hinge
    const side = this.sides[index]
    out.set(box.min.x + (box.max.x - box.min.x) * 0.82, box.min.y + 1.05, side > 0 ? box.max.z + 0.02 : box.min.z - 0.02)
    this.motion.makeRotationY(DOOR_OPEN_ANGLE * easeDoor(this.open[index]) * side)
    return out.applyMatrix4(this.matrix.multiplyMatrices(this.placements[index], hinge.pre).multiply(this.motion))
  }

  /** Oculta o enseña una copia entera (por ejemplo, el fondo oscuro de la puerta de un edificio en el que se puede entrar). */
  setShown(index: number, shown: boolean) {
    if (Boolean(this.shown[index]) === shown) return
    this.shown[index] = shown ? 1 : 0
    for (const { mesh, local } of this.fixed) {
      mesh.setMatrixAt(index, shown ? this.matrix.multiplyMatrices(this.placements[index], local) : InstancedProp.hidden)
      mesh.instanceMatrix.needsUpdate = true
    }
    for (const leaf of this.leaves) {
      this.writeLeaf(leaf, index)
      leaf.mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose() {
    for (const object of this.group.children) (object as THREE.InstancedMesh).dispose()
    this.group.removeFromParent()
  }
}
