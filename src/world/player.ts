import { resolveCircle, resolveCircles, type Box, type Circle } from './collision'
import { RUN_SPEED, WALK_SPEED } from './gait'

export const PLAYER_RADIUS = 0.3
export const PLAYER_ID = -1

export interface PlayerState {
  x: number
  z: number
  vx: number
  vz: number
  /** hacia dónde mira el personaje: dirección (sin yaw, cos yaw) */
  yaw: number
  /** velocidad real sobre el suelo (tras chocar con paredes), m/s */
  speed: number
}

export interface PlayerInput {
  /** -1 izquierda, 1 derecha */
  moveX: number
  /** -1 atrás, 1 adelante */
  moveZ: number
  run: boolean
}

export const newPlayer = (x: number, z: number, yaw: number): PlayerState => ({ x, z, vx: 0, vz: 0, yaw, speed: 0 })

const ACCELERATION = 16
const BRAKING = 22
const TURN_RATE = 11

/** Ángulo equivalente a `angle` más cercano a `reference` (para girar por el camino corto). */
export function nearestAngle(angle: number, reference: number): number {
  const full = Math.PI * 2
  return angle + Math.round((reference - angle) / full) * full
}

/** Avanza al jugador un instante: la entrada es relativa a la cámara (`cameraYaw`). */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  cameraYaw: number,
  dt: number,
  obstacles: readonly Box[],
  actors: readonly Circle[] = [],
) {
  let { moveX, moveZ } = input
  const length = Math.hypot(moveX, moveZ)
  if (length > 1) {
    moveX /= length
    moveZ /= length
  }
  // la cámara mira hacia (-sin, -cos); la derecha de la pantalla es (cos, -sin)
  const forwardX = -Math.sin(cameraYaw)
  const forwardZ = -Math.cos(cameraYaw)
  const rightX = Math.cos(cameraYaw)
  const rightZ = -Math.sin(cameraYaw)
  const top = input.run ? RUN_SPEED : WALK_SPEED
  const wantX = (forwardX * moveZ + rightX * moveX) * top
  const wantZ = (forwardZ * moveZ + rightZ * moveX) * top

  const rate = Math.hypot(wantX, wantZ) > 0.01 ? ACCELERATION : BRAKING
  const blend = 1 - Math.exp(-rate * dt)
  state.vx += (wantX - state.vx) * blend
  state.vz += (wantZ - state.vz) * blend
  if (Math.hypot(state.vx, state.vz) < 0.02 && length === 0) {
    state.vx = 0
    state.vz = 0
  }

  const fromX = state.x
  const fromZ = state.z
  // paredes, luego otras personas, y de nuevo paredes por si el empujón de una persona lo metió en una
  const target = { x: fromX + state.vx * dt, z: fromZ + state.vz * dt }
  const afterWalls = resolveCircle(target, PLAYER_RADIUS, obstacles)
  const afterActors = resolveCircles(afterWalls, PLAYER_RADIUS, actors, PLAYER_ID)
  const next = resolveCircle(afterActors, PLAYER_RADIUS, obstacles)
  state.x = next.x
  state.z = next.z
  state.speed = dt > 0 ? Math.hypot(state.x - fromX, state.z - fromZ) / dt : 0

  // se vuelve hacia donde va (no hacia donde empuja la pared)
  if (Math.hypot(state.vx, state.vz) > 0.25) {
    const desired = nearestAngle(Math.atan2(state.vx, state.vz), state.yaw)
    state.yaw += (desired - state.yaw) * (1 - Math.exp(-TURN_RATE * dt))
  }
}
