import * as THREE from 'three'

const worldA = new THREE.Vector3()
const worldB = new THREE.Vector3()
const target = new THREE.Vector3()
const delta = new THREE.Quaternion()
const boneWorld = new THREE.Quaternion()
const parentWorld = new THREE.Quaternion()

/** Gira `bone` para que el segmento hacia `child` apunte hacia `direction` (en coordenadas del mundo). */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, direction: THREE.Vector3) {
  bone.updateWorldMatrix(true, false)
  child.updateWorldMatrix(true, false)
  bone.getWorldPosition(worldA)
  child.getWorldPosition(worldB)
  worldB.sub(worldA).normalize()
  target.copy(direction).normalize()
  delta.setFromUnitVectors(worldB, target)
  bone.getWorldQuaternion(boneWorld)
  boneWorld.premultiply(delta)
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentWorld)
    bone.quaternion.copy(parentWorld.invert().multiply(boneWorld))
  } else {
    bone.quaternion.copy(boneWorld)
  }
  bone.updateMatrixWorld(true)
}

export interface AvatarPose {
  /** Anima la respiración y un leve balanceo. `time` en segundos. */
  idle(time: number): void
  /** Vuelve a la pose natural estática. */
  reset(): void
}

/** Baja los brazos de la pose en A a una postura natural y devuelve el controlador de la animación idle. */
export function applyNaturalPose(root: THREE.Object3D): AvatarPose {
  root.updateMatrixWorld(true)
  const get = (name: string) => root.getObjectByName(name)

  for (const side of ['l', 'r'] as const) {
    const upper = get(`upperarm_${side}`)
    const lower = get(`lowerarm_${side}`)
    const hand = get(`hand_${side}`)
    if (!upper || !lower || !hand) continue
    // hacia fuera del cuerpo: el signo depende del lado en el que esté el brazo
    const outward = Math.sign(lower.getWorldPosition(worldA).x - upper.getWorldPosition(worldB).x) || 1
    aimBone(upper, lower, new THREE.Vector3(outward * 0.2, -1, 0.02))
    aimBone(lower, hand, new THREE.Vector3(outward * 0.14, -1, 0.3))
  }

  const animated = ['spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r']
    .map((name) => get(name))
    .filter((bone): bone is THREE.Object3D => Boolean(bone))
  const base = animated.map((bone) => bone.quaternion.clone())
  const offset = new THREE.Quaternion()
  const euler = new THREE.Euler()

  const apply = (breath: number, sway: number) => {
    animated.forEach((bone, index) => {
      const name = bone.name
      if (name.startsWith('spine')) euler.set(breath * 0.012, 0, sway * 0.006)
      else if (name.startsWith('clavicle')) euler.set(0, 0, (name.endsWith('_l') ? 1 : -1) * breath * 0.01)
      else euler.set(-breath * 0.008, sway * 0.02, 0)
      offset.setFromEuler(euler)
      bone.quaternion.copy(base[index]).multiply(offset)
    })
  }

  return {
    idle(time) {
      apply(Math.sin(time * 1.5), Math.sin(time * 0.6))
    },
    reset() {
      apply(0, 0)
    },
  }
}
