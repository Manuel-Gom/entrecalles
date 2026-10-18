import * as THREE from 'three'
import type { AvatarAssembly } from '../avatar/assembler'
import { strikeCount } from './audio'
import { computeGait, cyclesPerMeter, type GaitDims, type GaitPose } from './gait'

const euler = new THREE.Euler()
const rotation = new THREE.Quaternion()
const parentChar = new THREE.Quaternion()
const inverse = new THREE.Quaternion()
const offset = new THREE.Vector3()

export interface LocomotorInput {
  /** velocidad actual en m/s */
  speed: number
  /** 0 de pie, 1 sentado */
  sit: number
  /** 0 callado, 1 hablando */
  talk: number
  time: number
  /** velocidad de giro (rad/s), positivo hacia la izquierda */
  turn?: number
  /** altura del asiento (m) si está sentado */
  seatHeight?: number
}

/** Lleva un `GaitPose` (ángulos) a los huesos del personaje, con independencia de cómo esté orientado cada hueso. */
export class Locomotor {
  readonly dims: GaitDims
  private phase: number
  private readonly seed: number
  private readonly root: THREE.Object3D
  private readonly bones: Record<string, THREE.Bone | undefined> = {}
  private readonly rest = new Map<string, THREE.Quaternion>()
  private readonly pelvisRest = new THREE.Vector3()
  /** +1 si el hueso "l" está del lado +X del personaje, -1 si está del -X */
  private readonly sideL: number
  pose: GaitPose | null = null
  /** pasos (0-2) que ha dado en la última actualización: los pies que han tocado el suelo, para los sonidos */
  strikes = 0

  private readonly assembly: AvatarAssembly

  constructor(assembly: AvatarAssembly, seed: number) {
    this.assembly = assembly
    this.root = assembly.root
    this.seed = seed
    this.phase = (seed * 0.6180339) % 1
    const names = [
      'pelvis', 'spine_01', 'spine_02', 'spine_03', 'head',
      'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r',
      'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
    ]
    for (const name of names) {
      const bone = assembly.bone(name)
      this.bones[name] = bone
      if (bone) this.rest.set(name, bone.quaternion.clone())
    }
    this.root.updateMatrixWorld(true)
    const pelvis = this.bones.pelvis
    if (pelvis) this.pelvisRest.copy(pelvis.position)

    const world = (name: string) => this.bones[name]?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3()
    const hip = world('thigh_l')
    const knee = world('calf_l')
    const ankle = world('foot_l')
    this.dims = {
      thigh: hip.distanceTo(knee) || 0.45,
      shin: knee.distanceTo(ankle) || 0.45,
      // la articulación de la cadera (no el hueso de la pelvis) es lo que se apoya en el asiento
      hipHeight: hip.y || 0.95,
    }
    this.sideL = world('upperarm_l').x >= world('upperarm_r').x ? 1 : -1
  }

  /** Rota el hueso `delta` (ángulos Euler en el sistema del personaje) sobre la orientación `base`. */
  private turn(name: string, base: THREE.Quaternion, x: number, y = 0, z = 0) {
    const bone = this.bones[name]
    if (!bone) return
    // orientación del padre en el sistema del personaje
    parentChar.identity()
    const chain: THREE.Object3D[] = []
    for (let node = bone.parent; node && node !== this.root; node = node.parent) chain.push(node)
    for (let i = chain.length - 1; i >= 0; i--) parentChar.multiply(chain[i].quaternion)
    inverse.copy(parentChar).invert()
    euler.set(x, y, z, 'YXZ')
    rotation.setFromEuler(euler)
    bone.quaternion.copy(inverse).multiply(rotation).multiply(parentChar).multiply(base)
  }

  private restOf(name: string): THREE.Quaternion {
    return this.rest.get(name) ?? rotation.identity()
  }

  /** Avanza la zancada según lo recorrido y coloca los huesos. */
  update(dt: number, input: LocomotorInput) {
    const { speed } = input
    const before = this.phase
    this.phase = (this.phase + speed * dt * cyclesPerMeter(speed, this.dims)) % 1
    this.strikes = speed > 0.3 ? strikeCount(before, this.phase) : 0
    // respiración y balanceo del reposo; quedan en spine_02/03, cuello, cabeza y clavículas
    this.assembly.pose.idle(input.time)
    const pose = computeGait({ phase: this.phase, speed, sit: input.sit, talk: input.talk, time: input.time, seed: this.seed, turn: input.turn, seatHeight: input.seatHeight }, this.dims)
    this.pose = pose
    this.apply(pose)
  }

  private apply(pose: GaitPose) {
    const spine1 = this.restOf('spine_01')
    const spine2 = this.bones.spine_02?.quaternion.clone() ?? this.restOf('spine_02')
    const spine3 = this.bones.spine_03?.quaternion.clone() ?? this.restOf('spine_03')
    const head = this.bones.head?.quaternion.clone() ?? this.restOf('head')

    // pelvis: se mueve en el sistema del personaje y se gira
    const pelvis = this.bones.pelvis
    if (pelvis) {
      parentChar.identity()
      const chain: THREE.Object3D[] = []
      for (let node = pelvis.parent; node && node !== this.root; node = node.parent) chain.push(node)
      for (let i = chain.length - 1; i >= 0; i--) parentChar.multiply(chain[i].quaternion)
      offset.set(0, pose.pelvisDrop, -pose.pelvisBack).applyQuaternion(inverse.copy(parentChar).invert())
      pelvis.position.copy(this.pelvisRest).add(offset)
    }
    this.turn('pelvis', this.restOf('pelvis'), 0, pose.pelvisYaw, pose.pelvisRoll)

    // columna: se inclina hacia delante y contragira respecto a la pelvis
    const lean = pose.spineLean / 3
    this.turn('spine_01', spine1, lean, pose.spineTwist * 0.3 - pose.pelvisYaw * 0.3, -pose.pelvisRoll * 0.5 + pose.spineRoll / 3)
    this.turn('spine_02', spine2, lean, pose.spineTwist * 0.4 - pose.pelvisYaw * 0.3, pose.spineRoll / 3)
    this.turn('spine_03', spine3, lean, pose.spineTwist * 0.3 - pose.pelvisYaw * 0.4, pose.spineRoll / 3)
    this.turn('head', head, pose.headPitch - pose.spineLean * 0.5, pose.headYaw - pose.spineTwist * 0.2)

    for (const side of ['l', 'r'] as const) {
      const left = side === 'l'
      const outward = (left ? 1 : -1) * this.sideL
      this.turn(`thigh_${side}`, this.restOf(`thigh_${side}`), left ? pose.thighL : pose.thighR)
      this.turn(`calf_${side}`, this.restOf(`calf_${side}`), left ? pose.kneeL : pose.kneeR)
      this.turn(`foot_${side}`, this.restOf(`foot_${side}`), left ? pose.footL : pose.footR)
      this.turn(`upperarm_${side}`, this.restOf(`upperarm_${side}`), left ? pose.armL : pose.armR, 0, outward * (left ? pose.armOutL : pose.armOutR))
      this.turn(`lowerarm_${side}`, this.restOf(`lowerarm_${side}`), -(left ? pose.elbowL : pose.elbowR))
    }
    this.root.updateMatrixWorld(true)
  }
}
