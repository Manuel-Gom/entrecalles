import * as THREE from 'three'

/**
 * Adapta animaciones de Mixamo (esqueleto `mixamorig`, en T) al esqueleto de nuestros cuerpos (nombres tipo UE4, en A).
 * Cada cuerpo tiene su propio reposo (proporciones y ángulos distintos), así que la animación se adapta por cuerpo:
 *  1. el reposo del cuerpo se "endereza" hasta la T de Mixamo, hueso a hueso, para que cada hueso apunte a su hijo igual
 *     que en el origen;
 *  2. en cada fotograma se toma el giro de cada hueso de Mixamo respecto a su reposo, en el sistema del personaje, y se
 *     aplica sobre ese reposo enderezado;
 *  3. la cadera se desplaza lo mismo que la de Mixamo, a escala de la altura de la cadera.
 * Sin WebGL: solo matemática de Three.js.
 */

/** Nombre de Mixamo (sin el prefijo `mixamorig`) → hueso del cuerpo. */
export const MIXAMO_TO_BODY: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head' }
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']] as const) {
    Object.assign(map, {
      [`${side}Shoulder`]: `clavicle_${s}`,
      [`${side}Arm`]: `upperarm_${s}`,
      [`${side}ForeArm`]: `lowerarm_${s}`,
      [`${side}Hand`]: `hand_${s}`,
      [`${side}UpLeg`]: `thigh_${s}`,
      [`${side}Leg`]: `calf_${s}`,
      [`${side}Foot`]: `foot_${s}`,
      [`${side}ToeBase`]: `ball_${s}`,
    })
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      for (let i = 1; i <= 3; i++) map[`${side}Hand${finger}${i}`] = `${finger.toLowerCase()}_0${i}_${s}`
    }
  }
  return map
})()

/** Hijo hacia el que apunta cada hueso del cuerpo (para enderezar su reposo). Los que no están no se enderezan. */
const AIM_CHILD: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head' }
  for (const s of ['l', 'r']) {
    Object.assign(map, {
      [`clavicle_${s}`]: `upperarm_${s}`,
      [`upperarm_${s}`]: `lowerarm_${s}`,
      [`lowerarm_${s}`]: `hand_${s}`,
      [`hand_${s}`]: `middle_01_${s}`,
      [`thigh_${s}`]: `calf_${s}`,
      [`calf_${s}`]: `foot_${s}`,
      [`foot_${s}`]: `ball_${s}`,
    })
    for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      map[`${finger}_01_${s}`] = `${finger}_02_${s}`
      map[`${finger}_02_${s}`] = `${finger}_03_${s}`
    }
  }
  return map
})()

/** Para el giro sobre el propio hueso: la línea de los nudillos (del índice al meñique) de esa mano. */
const TWIST_HINT: Readonly<Record<string, readonly [string, string]>> = (() => {
  const map: Record<string, readonly [string, string]> = {}
  for (const s of ['l', 'r']) {
    const knuckles = [`index_01_${s}`, `pinky_01_${s}`] as const
    for (const bone of [`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`]) map[bone] = knuckles
    for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) for (const i of [1, 2]) map[`${finger}_0${i}_${s}`] = knuckles
  }
  return map
})()

const mixamoName = (name: string) => name.replace(/^mixamorig\d*:?/, '')

export interface MotionClip {
  /** pistas sobre los huesos del cuerpo (rotaciones y posición de la pelvis), con el ciclo de 0 a `duration` */
  clip: THREE.AnimationClip
  /** metros que avanza el cuerpo en un ciclo completo (dos pasos), para que el pie apoyado no patine */
  stride: number
  /** momento del ciclo (0-1) en el que apoya el pie izquierdo */
  leftContact: number
}

interface Joint {
  name: string
  parent: Joint | null
  /** reposo local del cuerpo */
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** giro en el sistema del personaje del reposo enderezado */
  aligned: THREE.Quaternion
  /** nombre del hueso de Mixamo que lo mueve */
  source: string | null
}

const tmpVector = new THREE.Vector3()
const tmpScale = new THREE.Vector3()

/** El esqueleto del cuerpo en su pose de enlace (la de antes de bajar los brazos), del padre al hijo. */
function bodyJoints(target: THREE.Object3D) {
  let skinned: THREE.SkinnedMesh | null = null
  target.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh
    if (!skinned && mesh.isSkinnedMesh && mesh.skeleton.getBoneByName('pelvis')) skinned = mesh
  })
  if (!skinned) throw new Error('El cuerpo no tiene esqueleto')
  const { skeleton } = skinned as THREE.SkinnedMesh
  const bind = new Map<string, THREE.Matrix4>()
  skeleton.bones.forEach((bone, i) => bind.set(bone.name, skeleton.boneInverses[i].clone().invert()))

  const pelvis = skeleton.getBoneByName('pelvis') as THREE.Bone
  const top = pelvis.parent as THREE.Object3D
  // del sistema del personaje (target) al padre de la pelvis, tal como está ahora (no se anima)
  target.updateMatrixWorld(true)
  const base = target.matrixWorld.clone().invert().multiply(top.matrixWorld)

  const joints: Joint[] = []
  const visit = (bone: THREE.Object3D, parent: Joint | null) => {
    if (!(bone as THREE.Bone).isBone) return
    const own = bind.get(bone.name)
    const parentBind = bone.parent ? bind.get(bone.parent.name) : undefined
    if (!own) return
    const local = parentBind ? parentBind.clone().invert().multiply(own) : null
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    if (local) local.decompose(position, quaternion, tmpScale)
    else {
      position.copy(bone.position)
      quaternion.copy(bone.quaternion)
    }
    const joint: Joint = { name: bone.name, parent, position, quaternion, aligned: new THREE.Quaternion(), source: null }
    joints.push(joint)
    for (const child of bone.children) visit(child, joint)
  }
  visit(pelvis, null)
  return { joints, base }
}

/** Posiciones y giros en el sistema del personaje de una cadena de articulaciones dada por (posición, giro) locales. */
function forward(
  joints: readonly Joint[],
  base: THREE.Matrix4,
  local: (joint: Joint) => { position: THREE.Vector3; quaternion: THREE.Quaternion },
  out: Map<string, THREE.Matrix4>,
) {
  for (const joint of joints) {
    const { position, quaternion } = local(joint)
    const parent = joint.parent ? (out.get(joint.parent.name) as THREE.Matrix4) : base
    const matrix = out.get(joint.name) ?? new THREE.Matrix4()
    matrix.compose(position, quaternion, tmpScale.set(1, 1, 1)).premultiply(parent)
    out.set(joint.name, matrix)
  }
  return out
}

const positionOf = (matrix: THREE.Matrix4, into = new THREE.Vector3()) => into.setFromMatrixPosition(matrix)
const rotationOf = (matrix: THREE.Matrix4, into = new THREE.Quaternion()) => {
  matrix.decompose(tmpVector, into, tmpScale)
  return into
}

/** Adapta `clip` (de la escena de Mixamo `source`) al cuerpo montado en `target` (la raíz de un `AvatarAssembly`). */
export function retargetMixamo(source: THREE.Object3D, clip: THREE.AnimationClip, target: THREE.Object3D): MotionClip {
  // --- origen: reposo y pistas ---
  source.updateMatrixWorld(true)
  const sourceInverse = source.matrixWorld.clone().invert()
  const sourceNodes = new Map<string, THREE.Object3D>()
  source.traverse((object) => {
    if (/^mixamorig/.test(object.name)) sourceNodes.set(mixamoName(object.name), object)
  })
  const hips = sourceNodes.get('Hips')
  if (!hips?.parent) throw new Error('La animación no tiene el esqueleto de Mixamo')
  const sourceRest = new Map<string, THREE.Matrix4>()
  for (const [name, node] of sourceNodes) sourceRest.set(name, sourceInverse.clone().multiply(node.matrixWorld))
  const sourceBase = sourceInverse.clone().multiply(hips.parent.matrixWorld)

  // cada pista se lee por tiempo: el exportador deja con dos claves las que no cambian (p. ej. dedos quietos)
  const tracks = new Map<string, (time: number) => ArrayLike<number>>()
  for (const track of clip.tracks) {
    const size = track.getValueSize()
    const Interpolant = track instanceof THREE.QuaternionKeyframeTrack ? THREE.QuaternionLinearInterpolant : THREE.LinearInterpolant
    const interpolant = new Interpolant(track.times, track.values, size, new Float32Array(size))
    tracks.set(track.name, (time) => interpolant.evaluate(time))
  }
  const times = clip.tracks.reduce((longest, track) => (track.times.length > longest.length ? track.times : longest), clip.tracks[0].times)
  const frames = times.length
  // nodos de Mixamo del padre al hijo
  const sourceOrder: THREE.Object3D[] = []
  hips.traverse((node) => {
    if (sourceNodes.has(mixamoName(node.name))) sourceOrder.push(node)
  })

  // --- destino: reposo y reposo enderezado ---
  const { joints, base } = bodyJoints(target)
  const bodyToSource = new Map(Object.entries(MIXAMO_TO_BODY).map(([from, to]) => [to, from]))
  for (const joint of joints) joint.source = bodyToSource.get(joint.name) ?? null
  const byName = new Map(joints.map((joint) => [joint.name, joint]))
  // altura de la base de los dedos con el cuerpo de pie en reposo (con los pies en el suelo)
  const restBall = positionOf(forward(joints, base, (j) => j, new Map()).get('ball_l') as THREE.Matrix4).y

  // se endereza del padre al hijo: cada giro arrastra a los hijos, así que se recalcula la cadena tras cada uno
  const straight = new Map(joints.map((joint) => [joint.name, joint.quaternion.clone()]))
  const world = new Map<string, THREE.Matrix4>()
  const fromSource = new THREE.Vector3()
  const fromBody = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  for (const joint of joints) {
    forward(joints, base, (j) => ({ position: j.position, quaternion: straight.get(j.name) as THREE.Quaternion }), world)
    const child = AIM_CHILD[joint.name]
    const childJoint = child ? byName.get(child) : undefined
    const sourceFrom = joint.source ? sourceRest.get(joint.source) : undefined
    const sourceTo = childJoint?.source ? sourceRest.get(childJoint.source) : undefined
    if (!childJoint || !sourceFrom || !sourceTo) continue
    fromSource.subVectors(positionOf(sourceTo), positionOf(sourceFrom)).normalize()
    fromBody.subVectors(positionOf(world.get(childJoint.name) as THREE.Matrix4), positionOf(world.get(joint.name) as THREE.Matrix4)).normalize()
    turn.setFromUnitVectors(fromBody, fromSource)
    // en brazos, manos y dedos también cuenta el giro sobre el propio hueso (hacia dónde mira la palma): se iguala la
    // línea de los nudillos; sin esto los dedos se doblaban de lado, metiéndose unos en otros
    const hint = TWIST_HINT[joint.name]
    const hintSource = hint && sourceRest.get(bodyToSource.get(hint[0]) ?? '')
    const hintSourceEnd = hint && sourceRest.get(bodyToSource.get(hint[1]) ?? '')
    if (hint && hintSource && hintSourceEnd) {
      // la parte de un vector perpendicular al hueso
      const across = (v: THREE.Vector3) => v.clone().sub(v.clone().projectOnVector(fromSource)).normalize()
      const wantAcross = across(positionOf(hintSourceEnd).sub(positionOf(hintSource)))
      const haveAcross = across(
        positionOf(world.get(hint[1]) as THREE.Matrix4)
          .sub(positionOf(world.get(hint[0]) as THREE.Matrix4))
          .applyQuaternion(turn),
      )
      const angle = Math.atan2(new THREE.Vector3().crossVectors(haveAcross, wantAcross).dot(fromSource), haveAcross.dot(wantAcross))
      turn.premultiply(new THREE.Quaternion().setFromAxisAngle(fromSource, angle))
    }
    const global = rotationOf(world.get(joint.name) as THREE.Matrix4).premultiply(turn)
    const parentGlobal = joint.parent ? rotationOf(world.get(joint.parent.name) as THREE.Matrix4) : rotationOf(base)
    straight.set(joint.name, parentGlobal.invert().multiply(global))
  }
  forward(joints, base, (j) => ({ position: j.position, quaternion: straight.get(j.name) as THREE.Quaternion }), world)
  for (const joint of joints) rotationOf(world.get(joint.name) as THREE.Matrix4, joint.aligned)

  const pelvisRest = positionOf(world.get('pelvis') as THREE.Matrix4)
  const hipsRest = positionOf(sourceRest.get('Hips') as THREE.Matrix4)
  // la cadera de Mixamo está a otra altura (y en otras unidades): se escala por la altura de la cadera sobre el suelo
  const footRest = positionOf(world.get('foot_l') as THREE.Matrix4)
  const sourceFootRest = positionOf(sourceRest.get('LeftFoot') as THREE.Matrix4)
  const scale = (pelvisRest.y - footRest.y) / Math.max(1e-6, hipsRest.y - sourceFootRest.y)
  const baseInverse = base.clone().invert()

  // --- fotograma a fotograma ---
  const values = new Map(joints.map((joint) => [joint.name, new Float32Array(frames * 4)]))
  const pelvisPath: THREE.Vector3[] = []
  const feet = { l: [] as THREE.Vector3[], r: [] as THREE.Vector3[] }
  const ballHeights = { l: [] as number[], r: [] as number[] }
  const sourceGlobal = new Map<string, THREE.Quaternion>()
  const sourceHips = new THREE.Vector3()
  const restInverse = new THREE.Quaternion()
  const delta = new THREE.Quaternion()
  const bodyGlobal = new Map<string, THREE.Quaternion>()
  const local = new THREE.Quaternion()
  const frameJoints = new Map(joints.map((joint) => [joint.name, { position: joint.position.clone(), quaternion: new THREE.Quaternion() }]))
  const posed = new Map<string, THREE.Matrix4>()
  const baseRotation = rotationOf(base)
  const sourceBaseRotation = rotationOf(sourceBase)

  // la cadera de Mixamo en cada fotograma; si la animación avanza (descargada sin «In Place»), se le quita ese avance
  // en horizontal, que es justo lo que mide la zancada
  const hipsTrack = tracks.get(`${hips.name}.position`)
  const hipsPath = Array.from({ length: frames }, (_, frame) =>
    hipsTrack ? new THREE.Vector3().fromArray(hipsTrack(times[frame])).applyMatrix4(sourceBase) : hipsRest.clone(),
  )
  const drift = hipsPath[frames - 1].clone().sub(hipsPath[0]).setY(0)
  const span = times[frames - 1] - times[0]
  hipsPath.forEach((point, frame) => point.addScaledVector(drift, -(times[frame] - times[0]) / span))
  const travelled = drift.length() * scale

  for (let frame = 0; frame < frames; frame++) {
    // giros del origen en el sistema del personaje
    for (const node of sourceOrder) {
      const name = mixamoName(node.name)
      const track = tracks.get(`${node.name}.quaternion`)
      const q = track ? new THREE.Quaternion().fromArray(track(times[frame])).normalize() : node.quaternion.clone()
      const parent = node === hips ? sourceBaseRotation : (sourceGlobal.get(mixamoName(node.parent?.name ?? '')) ?? sourceBaseRotation)
      sourceGlobal.set(name, parent.clone().multiply(q))
    }
    sourceHips.copy(hipsPath[frame])

    for (const joint of joints) {
      let global: THREE.Quaternion
      const from = joint.source ? sourceGlobal.get(joint.source) : undefined
      const rest = joint.source ? sourceRest.get(joint.source) : undefined
      if (from && rest) {
        rotationOf(rest, restInverse).invert()
        delta.copy(from).multiply(restInverse)
        global = delta.clone().multiply(joint.aligned)
      } else {
        const parent = joint.parent ? (bodyGlobal.get(joint.parent.name) as THREE.Quaternion) : baseRotation
        global = parent.clone().multiply(straight.get(joint.name) as THREE.Quaternion)
      }
      bodyGlobal.set(joint.name, global)
      const parent = joint.parent ? (bodyGlobal.get(joint.parent.name) as THREE.Quaternion) : baseRotation
      local.copy(parent).invert().multiply(global)
      local.toArray(values.get(joint.name) as Float32Array, frame * 4)
      ;(frameJoints.get(joint.name) as { quaternion: THREE.Quaternion }).quaternion.copy(local)
    }
    // la pelvis: su reposo más lo que se mueve la cadera de Mixamo, a escala
    const pelvis = new THREE.Vector3().subVectors(sourceHips, hipsRest).multiplyScalar(scale).add(pelvisRest)
    pelvisPath.push(pelvis)
    ;(frameJoints.get('pelvis') as { position: THREE.Vector3 }).position.copy(pelvis).applyMatrix4(baseInverse)

    forward(joints, base, (j) => frameJoints.get(j.name) as { position: THREE.Vector3; quaternion: THREE.Quaternion }, posed)
    for (const side of ['l', 'r'] as const) {
      // la planta: entre el tobillo y la base de los dedos
      const ankle = positionOf(posed.get(`foot_${side}`) as THREE.Matrix4)
      const ball = positionOf(posed.get(`ball_${side}`) as THREE.Matrix4)
      ballHeights[side].push(ball.y)
      feet[side].push(ankle.add(ball).multiplyScalar(0.5))
    }
  }

  // con otras proporciones de pierna los dedos pueden hundirse en el suelo o flotar: se sube o baja la pelvis para que
  // el pie más bajo del ciclo pise a la altura del reposo
  let lowest = Infinity
  for (let frame = 0; frame < frames; frame++) lowest = Math.min(lowest, ballHeights.l[frame], ballHeights.r[frame])
  const lift = restBall - lowest
  const pelvisValues = new Float32Array(frames * 3)
  pelvisPath.forEach((point, frame) => point.setY(point.y + lift).applyMatrix4(baseInverse).toArray(pelvisValues, frame * 3))
  for (const side of ['l', 'r'] as const) for (const point of feet[side]) point.y += lift

  const start = times[0]
  const shifted = Float32Array.from(times, (t) => t - start)
  const duration = shifted[frames - 1]
  const outTracks: THREE.KeyframeTrack[] = joints.map(
    (joint) => new THREE.QuaternionKeyframeTrack(`${joint.name}.quaternion`, shifted, values.get(joint.name) as Float32Array),
  )
  outTracks.push(new THREE.VectorKeyframeTrack('pelvis.position', shifted, pelvisValues))
  // un NaN en un hueso hace desaparecer la parte de la malla que mueve: mejor no usar la animación
  const broken = outTracks.find((track) => !Array.prototype.every.call(track.values, Number.isFinite))
  if (broken) throw new Error(`La animación "${clip.name}" sale con valores no válidos en ${broken.name}`)
  const result = new THREE.AnimationClip(clip.name, duration, outTracks)

  const cycle = analyzeCycle(feet.l, feet.r, shifted)
  // con avance, la zancada es lo que avanza la cadera; en el sitio, lo que retrocede el pie apoyado
  return { clip: result, stride: travelled > 0.2 ? travelled : cycle.stride, leftContact: cycle.leftContact }
}

/**
 * Del recorrido de los pies en un ciclo sin avance: el pie más bajo es el apoyado, y retrocede a la velocidad a la que
 * avanzaría el cuerpo. Devuelve los metros por ciclo y el momento (0-1) en que el pie izquierdo pasa a apoyar.
 */
export function analyzeCycle(left: readonly THREE.Vector3[], right: readonly THREE.Vector3[], times: ArrayLike<number>) {
  const frames = left.length
  const duration = times[frames - 1] - times[0]
  const speeds: number[] = []
  let leftContact = 0
  let best = -Infinity
  for (let i = 0; i + 1 < frames; i++) {
    const leftDown = left[i].y <= right[i].y
    const dt = times[i + 1] - times[i]
    if (dt <= 0) continue
    // el pie apoyado (el que sigue siéndolo en el siguiente fotograma) retrocede en horizontal
    if (leftDown === left[i + 1].y <= right[i + 1].y) {
      const foot = leftDown ? left : right
      speeds.push(Math.hypot(foot[i + 1].x - foot[i].x, foot[i + 1].z - foot[i].z) / dt)
    }
    // el apoyo del pie izquierdo: donde más baja respecto al derecho al empezar a ser el más bajo
    const previous = i === 0 ? frames - 2 : i - 1
    const wasUp = left[previous].y > right[previous].y
    if (leftDown && wasUp) {
      const drop = right[i].y - left[i].y
      if (drop > best) {
        best = drop
        leftContact = (times[i] - times[0]) / duration
      }
    }
  }
  speeds.sort((a, b) => a - b)
  const speed = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 1
  return { stride: speed * duration, leftContact, speed }
}
