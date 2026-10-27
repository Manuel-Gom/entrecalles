import * as THREE from 'three'
import type { AvatarAssembly } from '../avatar/assembler'
import type { MotionClip } from '../avatar/retarget'
import { strikeCount } from './audio'
import { computeGait, cyclesPerMeter, movingFactor, runFactor, type GaitDims, type GaitPose } from './gait'

const euler = new THREE.Euler()
const rotation = new THREE.Quaternion()
const parentChar = new THREE.Quaternion()
const inverse = new THREE.Quaternion()
const offset = new THREE.Vector3()
const current = new THREE.Quaternion()
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Las animaciones de andar y correr ya adaptadas a este cuerpo (ver `retargetMixamo`). */
export interface MotionSet {
  walk: MotionClip
  run: MotionClip
}

interface Motion {
  set: MotionSet
  mixer: THREE.AnimationMixer
  walk: THREE.AnimationAction
  run: THREE.AnimationAction
}

/** En la fase del paso, el pie izquierdo apoya en 0,25 y el derecho en 0,75 (como en `computeGait` y `strikeCount`). */
const LEFT_STRIKE = 0.25

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
  /** alargar una mano hasta un punto del mundo (empujar una puerta y, más adelante, coger cosas) */
  reach?: Reach | null
}

/**
 * Una mano que se alarga hasta (x, y, z), en el mundo (donde va la muñeca), con un peso de 0 (nada) a 1 (llega). Solo
 * alcanza lo que tiene delante: si el punto se queda al lado o detrás, el brazo se recoge. `palm`: hacia dónde mira la
 * palma (si no, hacia el punto); los dedos, hacia arriba.
 */
export interface Reach {
  hand: 'l' | 'r'
  x: number
  y: number
  z: number
  weight: number
  palm?: { x: number; y: number; z: number }
}

const shoulder = new THREE.Vector3()
const elbow = new THREE.Vector3()
const wrist = new THREE.Vector3()
const goal = new THREE.Vector3()
const bend = new THREE.Vector3()
const dir = new THREE.Vector3()
const from = new THREE.Vector3()
const to = new THREE.Vector3()
const palm = new THREE.Vector3()
const knuckles = new THREE.Vector3()
const worldQuat = new THREE.Quaternion()
const parentQuat = new THREE.Quaternion()
const delta = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

/** Gira el hueso en el mundo para que la dirección `a` pase a ser `b` (las dos en el mundo). */
function aimWorld(bone: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) return
  delta.setFromUnitVectors(a.normalize(), b.normalize())
  bone.getWorldQuaternion(worldQuat)
  bone.parent?.getWorldQuaternion(parentQuat)
  bone.quaternion.copy(parentQuat.invert()).multiply(delta).multiply(worldQuat)
  bone.updateMatrixWorld(true)
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
  private motion: Motion | null = null
  /** todos los huesos con su orientación de partida, y una copia de la pose procedural para mezclarla con la animación */
  private readonly allBones: THREE.Bone[] = []
  private readonly baseQuats: THREE.Quaternion[] = []
  private readonly proceduralQuats: THREE.Quaternion[] = []
  private readonly proceduralPelvis = new THREE.Vector3()
  /** la cadena de cada brazo para alargar la mano, la orientación de antes (para mezclar) y hacia dónde mira la palma */
  private readonly arms: Record<'l' | 'r', { bones: THREE.Bone[]; saved: THREE.Quaternion[]; palmSign: number } | null>

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
    const arm = (side: 'l' | 'r') => {
      const bones = ['spine_03', `upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`, `middle_01_${side}`, `index_01_${side}`, `pinky_01_${side}`].map((name) => assembly.bone(name))
      if (bones.some((bone) => !bone)) return null
      const chain = bones as THREE.Bone[]
      // con los brazos caídos la palma mira al muslo: así se sabe hacia qué lado del dorso queda la palma de esta mano
      const [, , , hand, middle, index, pinky] = chain.map((bone) => bone.getWorldPosition(new THREE.Vector3()))
      const side3 = new THREE.Vector3().subVectors(this.bones.pelvis?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(), hand).setY(0)
      const normal = new THREE.Vector3().subVectors(middle, hand).cross(new THREE.Vector3().subVectors(index, pinky))
      return { bones: chain.slice(0, 4), saved: chain.slice(0, 4).map(() => new THREE.Quaternion()), palmSign: normal.dot(side3) >= 0 ? 1 : -1 }
    }
    this.arms = { l: arm('l'), r: arm('r') }
    this.root.traverse((object) => {
      if (!(object as THREE.Bone).isBone) return
      this.allBones.push(object as THREE.Bone)
      this.baseQuats.push(object.quaternion.clone())
      this.proceduralQuats.push(new THREE.Quaternion())
    })
  }

  /** Si anda y corre con animaciones (y la zancada de cada una, en metros por ciclo). */
  get motionInfo() {
    const set = this.motion?.set
    return set ? { walkStride: set.walk.stride, runStride: set.run.stride, walkContact: set.walk.leftContact, runContact: set.run.leftContact } : null
  }

  /** Anda y corre con animaciones en vez de con la zancada calculada (null: vuelve a la calculada). */
  useMotion(set: MotionSet | null) {
    this.motion?.mixer.stopAllAction()
    this.motion = null
    if (!set) return
    const mixer = new THREE.AnimationMixer(this.root)
    const walk = mixer.clipAction(set.walk.clip)
    const run = mixer.clipAction(set.run.clip)
    for (const action of [walk, run]) action.play()
    this.motion = { set, mixer, walk, run }
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
    const { motion } = this
    const before = this.phase
    // con animaciones, cada ciclo avanza lo que mide la zancada de la animación: así el pie apoyado no patina
    const perMeter = motion ? 1 / lerp(motion.set.walk.stride, motion.set.run.stride, runFactor(speed)) : cyclesPerMeter(speed, this.dims)
    this.phase = (this.phase + speed * dt * perMeter) % 1
    this.strikes = speed > 0.3 ? strikeCount(before, this.phase) : 0
    // la animación deja girados huesos que la pose calculada no toca (manos, dedos, puntas de los pies): se parte de cero
    if (motion) this.allBones.forEach((bone, i) => bone.quaternion.copy(this.baseQuats[i]))
    // respiración y balanceo del reposo; quedan en spine_02/03, cuello, cabeza y clavículas
    this.assembly.pose.idle(input.time)
    const pose = computeGait({ phase: this.phase, speed, sit: input.sit, talk: input.talk, time: input.time, seed: this.seed, turn: input.turn, seatHeight: input.seatHeight }, this.dims)
    this.pose = pose
    this.apply(pose)
    if (motion) this.applyMotion(motion, pose, input)
    this.root.updateMatrixWorld(true)
    if (input.reach && input.reach.weight > 0.001) this.applyReach(input.reach)
  }

  /**
   * Alarga una mano hasta un punto (IK de dos huesos sobre la pose que ya hay): el pecho gira un poco hacia ese lado, el
   * codo se dobla hacia donde ya estaba doblado (y algo hacia abajo), y la mano va abierta, con los dedos hacia arriba y
   * la palma hacia el punto. Se mezcla con la pose de antes según el peso.
   */
  private applyReach(reach: Reach) {
    const arm = this.arms[reach.hand]
    if (!arm) return
    const [chest, upper, lower, hand] = arm.bones
    // solo lo que tiene delante: con el punto al lado o detrás (ya ha cruzado la puerta), el brazo se recoge
    this.root.getWorldQuaternion(worldQuat)
    to.set(0, 0, 1).applyQuaternion(worldQuat).setY(0).normalize()
    chest.getWorldPosition(from)
    dir.set(reach.x - from.x, 0, reach.z - from.z).normalize()
    const ahead = dir.dot(to)
    const weight = reach.weight * Math.min(1, Math.max(0, (ahead - 0.15) / 0.35))
    if (weight <= 0.001) return
    arm.bones.forEach((bone, i) => arm.saved[i].copy(bone.quaternion))
    const middle = this.assembly.bone(`middle_01_${reach.hand}`) as THREE.Bone
    const index = this.assembly.bone(`index_01_${reach.hand}`) as THREE.Bone
    const pinky = this.assembly.bone(`pinky_01_${reach.hand}`) as THREE.Bone

    // el hombro de esa mano, un poco hacia delante
    const forward = (reach.hand === 'l' ? -1 : 1) * this.sideL
    this.turn('spine_03', current.copy(chest.quaternion), 0, forward * 0.16)
    chest.updateMatrixWorld(true)

    upper.getWorldPosition(shoulder)
    lower.getWorldPosition(elbow)
    hand.getWorldPosition(wrist)
    const a = shoulder.distanceTo(elbow)
    const b = elbow.distanceTo(wrist)
    goal.set(reach.x, reach.y, reach.z)
    dir.subVectors(goal, shoulder)
    const d = Math.min(a + b - 0.005, Math.max(Math.abs(a - b) + 0.01, dir.length()))
    dir.normalize()
    // hacia dónde se dobla el codo: hacia donde ya estaba, algo hacia abajo, siempre de lado respecto al brazo
    bend.subVectors(elbow, shoulder).addScaledVector(UP, -0.5 * a)
    bend.addScaledVector(dir, -bend.dot(dir))
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(dir, -dir.y)
    bend.normalize()
    const along = (a * a - b * b + d * d) / (2 * d)
    const height = Math.sqrt(Math.max(0, a * a - along * along))
    to.copy(shoulder).addScaledVector(dir, along).addScaledVector(bend, height).sub(shoulder)
    aimWorld(upper, from.subVectors(elbow, shoulder), to)
    lower.getWorldPosition(elbow)
    hand.getWorldPosition(wrist)
    aimWorld(lower, from.subVectors(wrist, elbow), to.copy(shoulder).addScaledVector(dir, d).sub(elbow))

    // la mano: dedos hacia arriba (pegados a la hoja, sin meterse en ella) y la palma hacia ella
    hand.getWorldPosition(wrist)
    const push = to.copy(dir).setY(0)
    if (reach.palm) push.set(reach.palm.x, reach.palm.y, reach.palm.z)
    if (push.lengthSq() < 1e-8) push.copy(dir)
    push.normalize()
    middle.getWorldPosition(from).sub(wrist)
    aimWorld(hand, from, palm.copy(UP).addScaledVector(push, -push.dot(UP)))
    middle.getWorldPosition(from).sub(wrist).normalize()
    index.getWorldPosition(knuckles)
    pinky.getWorldPosition(palm)
    knuckles.sub(palm)
    // la normal de la palma, y la que se quiere (hacia el punto), las dos de lado respecto a los dedos
    palm.copy(from).cross(knuckles).multiplyScalar(arm.palmSign)
    palm.addScaledVector(from, -palm.dot(from))
    push.addScaledVector(from, -push.dot(from))
    aimWorld(hand, palm, push)

    if (weight < 1) arm.bones.forEach((bone, i) => bone.quaternion.slerpQuaternions(arm.saved[i], bone.quaternion, weight))
    chest.updateMatrixWorld(true)
  }

  /** Pone encima la animación de andar y correr, mezclada con la pose calculada según lo en marcha que vaya. */
  private applyMotion(motion: Motion, pose: GaitPose, input: LocomotorInput) {
    const weight = movingFactor(input.speed) * (1 - input.sit)
    if (weight <= 0) return
    const { allBones, proceduralQuats } = this
    allBones.forEach((bone, i) => proceduralQuats[i].copy(bone.quaternion))
    const pelvis = this.bones.pelvis
    if (pelvis) this.proceduralPelvis.copy(pelvis.position)

    const run = runFactor(input.speed)
    for (const [action, clip, share] of [
      [motion.walk, motion.set.walk, 1 - run],
      [motion.run, motion.set.run, run],
    ] as const) {
      action.setEffectiveWeight(share)
      action.time = (((this.phase - LEFT_STRIKE + clip.leftContact) % 1) + 1) % 1 * clip.clip.duration
    }
    motion.mixer.update(0)

    if (weight < 1) {
      allBones.forEach((bone, i) => bone.quaternion.slerpQuaternions(proceduralQuats[i], bone.quaternion, weight))
      if (pelvis) pelvis.position.lerpVectors(this.proceduralPelvis, pelvis.position, weight)
    }
    // en las curvas el cuerpo se inclina hacia dentro y la cabeza mira hacia donde gira
    const roll = pose.spineRoll * weight
    for (const name of ['spine_01', 'spine_02', 'spine_03']) {
      const bone = this.bones[name]
      if (bone) this.turn(name, current.copy(bone.quaternion), 0, 0, roll / 3)
    }
    const head = this.bones.head
    const look = Math.min(0.35, Math.max(-0.35, (input.turn ?? 0) * 0.18)) * weight
    if (head && look !== 0) this.turn('head', current.copy(head.quaternion), 0, look)
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
  }
}
