import * as THREE from 'three'
import { segmentEntry } from './collision'
import type { Blocker } from './layout'

const MIN_PITCH = -1.2
const MAX_PITCH = 1.25
const CAMERA_WALL_GAP = 0.18
const MIN_CAMERA_DISTANCE = 0.08

/** Cámara en tercera persona: orbita alrededor del personaje y se acerca si una pared se interpone. */
export class FollowCamera {
  yaw: number
  pitch = 0.32
  distance = 4.6
  /** tope de distancia (por ejemplo, dentro de una sala pequeña) */
  maxDistance = Infinity
  private current = 4.6
  private readonly focus = new THREE.Vector3()

  constructor(yaw: number) {
    this.yaw = yaw
  }

  orbit(deltaYaw: number, deltaPitch: number) {
    this.yaw += deltaYaw
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + deltaPitch))
  }

  zoom(delta: number) {
    this.distance = Math.min(8, Math.max(2.2, this.distance + delta))
  }

  /** Coloca `camera` mirando a `target` (los pies del personaje); con `instant` no suaviza el acercamiento. */
  update(camera: THREE.PerspectiveCamera, target: THREE.Vector3, blockers: readonly Blocker[], dt: number, instant: boolean) {
    this.focus.set(target.x, target.y + 1.45, target.z)
    const horizontal = Math.cos(this.pitch)
    const dirX = Math.sin(this.yaw) * horizontal
    const dirZ = Math.cos(this.yaw) * horizontal
    const dirY = Math.sin(this.pitch)

    // si hay una pared entre el personaje y la cámara, la cámara se queda delante de ella
    let allowed = Math.min(this.distance, this.maxDistance)
    const fromX = this.focus.x
    const fromZ = this.focus.z
    for (const { box, height } of blockers) {
      const t = segmentEntry(fromX, fromZ, fromX + dirX * allowed, fromZ + dirZ * allowed, box)
      if (t === null) continue
      // solo tapa si el rayo pasa por debajo del tejado
      const rayHeight = this.focus.y + dirY * allowed * t
      if (rayHeight < height) allowed = Math.min(allowed, Math.max(MIN_CAMERA_DISTANCE, t * allowed - CAMERA_WALL_GAP))
    }
    // se acerca de golpe y se aleja despacio, para que no tiemble
    this.current = instant || allowed < this.current ? allowed : this.current + (allowed - this.current) * (1 - Math.exp(-3 * dt))

    camera.position.set(
      this.focus.x + dirX * this.current,
      // nunca por debajo del suelo que pisa el personaje (en un piso, el de su planta)
      Math.max(target.y + 0.35, this.focus.y + dirY * this.current),
      this.focus.z + dirZ * this.current,
    )
    camera.lookAt(this.focus)
  }
}
