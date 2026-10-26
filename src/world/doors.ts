import * as THREE from 'three'
import type { Prop } from './props'

/** Hasta dónde gira una hoja abierta del todo (rad) y cuánto tarda en abrirse (s). */
export const DOOR_OPEN_ANGLE = 1.5
const DOOR_SECONDS = 0.55

/** Lleva `current` (0-1) hacia `target` a ritmo de puerta. */
export function swingTowards(current: number, target: number, dt: number, seconds = DOOR_SECONDS): number {
  const step = dt / seconds
  return current + Math.max(-step, Math.min(step, target - current))
}

interface Leaf {
  mesh: THREE.InstancedMesh
  /** de la colocación al eje de la hoja (la bisagra, o su sitio cerrada) y de ahí a la malla */
  pre: THREE.Matrix4
  post: THREE.Matrix4
  slide: number
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
  private readonly shown: Uint8Array
  private readonly matrix = new THREE.Matrix4()
  private readonly motion = new THREE.Matrix4()
  private static readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(prop: Prop, placements: readonly THREE.Matrix4[], shadows = true) {
    this.placements = placements.map((m) => m.clone())
    this.count = placements.length
    this.open = new Float32Array(this.count)
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
    const amount = this.open[index]
    if (leaf.slide !== 0) this.motion.makeTranslation(leaf.slide * amount, 0, 0)
    else this.motion.makeRotationY(DOOR_OPEN_ANGLE * amount)
    this.matrix.multiplyMatrices(this.placements[index], leaf.pre).multiply(this.motion).multiply(leaf.post)
    leaf.mesh.setMatrixAt(index, this.matrix)
  }

  /** Cuánto está abierta la puerta de la copia `index` (0 cerrada, 1 abierta). */
  openness(index: number): number {
    return this.open[index]
  }

  setOpen(index: number, amount: number) {
    if (Math.abs(this.open[index] - amount) < 1e-4) return
    this.open[index] = amount
    for (const leaf of this.leaves) {
      this.writeLeaf(leaf, index)
      leaf.mesh.instanceMatrix.needsUpdate = true
    }
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
