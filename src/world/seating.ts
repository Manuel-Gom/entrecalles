import type { Seat } from './brain'
import type { Box, Vec2 } from './collision'
import { nearestAngle } from './player'

/** Hasta qué distancia de una plaza se puede pulsar "sentarse". */
export const SEAT_REACH = 1.7
/** Tiempo mínimo sentado antes de que moverse lo levante (para que no se levante sin querer al sentarse). */
const MIN_SEATED = 0.5

/** La plaza libre más cercana a la que el jugador puede sentarse: cerca y por el lado por el que se llega a ella. */
export function findSeat(seats: readonly Seat[], x: number, z: number): Seat | null {
  let best: Seat | null = null
  let bestDistance = SEAT_REACH
  for (const seat of seats) {
    if (seat.taken) continue
    const dx = x - seat.x
    const dz = z - seat.z
    const distance = Math.hypot(dx, dz)
    // se llega por el lado que dice la plaza: por delante (bancos) o por detrás (sillas con mesa delante)
    const side = dx * Math.sin(seat.yaw) + dz * Math.cos(seat.yaw)
    const inFront = seat.entry === 'delante' ? side > 0.3 : side < -0.3
    if (inFront && distance <= bestDistance) {
      best = seat
      bestDistance = distance
    }
  }
  return best
}

export type SeatPhase = 'sentandose' | 'sentado' | 'levantandose'

const ease = (t: number) => t * t * (3 - 2 * t)
const WALKING_SPEED = 1.4

function overlaps(position: Vec2, radius: number, box: Box): boolean {
  const x = Math.max(box.minX, Math.min(position.x, box.maxX))
  const z = Math.max(box.minZ, Math.min(position.z, box.maxZ))
  return (position.x - x) ** 2 + (position.z - z) ** 2 < radius ** 2
}

function segmentIsClear(from: Vec2, to: Vec2, obstacles: readonly Box[], radius: number, ignored?: Box): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  const steps = Math.max(1, Math.ceil(distance / 0.08))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const point = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }
    if (obstacles.some((box) => box !== ignored && overlaps(point, radius, box))) return false
  }
  return true
}

/** Ruta de aproximación lateral para sentarse sin cruzar la espalda ni el armazón del asiento. */
export function makeSeatRoute(
  seat: Seat,
  obstacles: readonly Box[],
  ownCollider: Box | undefined = seat.collider,
  start: Vec2 = seat.approach,
): Vec2[] {
  const lateral = { x: Math.cos(seat.yaw), z: -Math.sin(seat.yaw) }
  const forward = { x: Math.sin(seat.yaw), z: Math.cos(seat.yaw) }
  const colliderWidth = ownCollider ? Math.max(ownCollider.maxX - ownCollider.minX, ownCollider.maxZ - ownCollider.minZ) : 0
  const offset = colliderWidth >= 0.55 ? 0.85 : 0.62
  for (const side of [1, -1]) {
    const rearSide = {
      x: seat.approach.x + lateral.x * offset * side,
      z: seat.approach.z + lateral.z * offset * side,
    }
    const seatSide = {
      x: seat.x + lateral.x * offset * side,
      z: seat.z + lateral.z * offset * side,
    }
    const path = [start, rearSide, seatSide, { x: seat.x, z: seat.z }]
    if (
      segmentIsClear(path[0], path[1], obstacles, PLAYER_ROUTE_RADIUS) &&
      segmentIsClear(path[1], path[2], obstacles, PLAYER_ROUTE_RADIUS) &&
      segmentIsClear(path[2], path[3], obstacles, PLAYER_ROUTE_RADIUS, ownCollider)
    ) {
      return path
    }
  }

  const shortPath = [start, { x: seat.x - forward.x * 0.35, z: seat.z - forward.z * 0.35 }, { x: seat.x, z: seat.z }]
  if (
    segmentIsClear(shortPath[0], shortPath[1], obstacles, PLAYER_ROUTE_RADIUS) &&
    segmentIsClear(shortPath[1], shortPath[2], obstacles, PLAYER_ROUTE_RADIUS, ownCollider)
  ) {
    return shortPath
  }
  throw new Error(`No se encontró una ruta libre para sentarse en ${seat.x.toFixed(2)}, ${seat.z.toFixed(2)}.`)
}

const PLAYER_ROUTE_RADIUS = 0.3

/** El jugador sentándose, sentado y levantándose: lleva su posición, orientación y cuánto está sentado (0-1). */
export class SeatSession {
  readonly seat: Seat
  phase: SeatPhase = 'sentandose'
  x: number
  z: number
  yaw: number
  /** 0 de pie, 1 sentado */
  sit = 0
  /** true cuando ha terminado de levantarse y el jugador recupera el control */
  done = false
  private progress = 0
  private seatedFor = 0
  private readonly fromYaw: number
  private readonly path: Vec2[]
  private readonly pathLength: number
  private readonly transitionSeconds: number

  constructor(seat: Seat, yaw: number, from: Vec2 = seat.approach, route: Vec2[] | undefined = seat.route) {
    this.seat = seat
    seat.taken = true
    this.path = route
      ? [from, ...route.slice(1)]
      : [from, seat.approach, { x: seat.x, z: seat.z }]
    this.pathLength = this.path.slice(1).reduce((distance, point, index) => {
      const previous = this.path[index]
      return distance + Math.hypot(point.x - previous.x, point.z - previous.z)
    }, 0)
    this.transitionSeconds = Math.max(0.9, this.pathLength / WALKING_SPEED)
    this.x = from.x
    this.z = from.z
    this.yaw = yaw
    this.fromYaw = yaw
  }

  /** Pide levantarse (solo si ya está sentado). Devuelve si se aceptó. */
  standUp(): boolean {
    if (this.phase !== 'sentado') return false
    this.phase = 'levantandose'
    return true
  }

  /** Levantarse porque el jugador empuja una dirección: solo tras un rato sentado. */
  pushToStand(): boolean {
    return this.seatedFor >= MIN_SEATED && this.standUp()
  }

  update(dt: number) {
    if (this.done) return
    if (this.phase === 'sentandose') {
      this.progress = Math.min(1, this.progress + dt / this.transitionSeconds)
      if (this.progress >= 1) this.phase = 'sentado'
    } else if (this.phase === 'sentado') {
      this.seatedFor += dt
    } else {
      this.progress = Math.max(0, this.progress - dt / this.transitionSeconds)
      if (this.progress <= 0) {
        this.done = true
        this.seat.taken = false
      }
    }
    const t = ease(this.progress)
    this.sit = t
    const position = this.positionAlongPath(t)
    this.x = position.x
    this.z = position.z
    const target = nearestAngle(this.seat.yaw, this.fromYaw)
    this.yaw = this.fromYaw + (target - this.fromYaw) * t
  }

  private positionAlongPath(progress: number): Vec2 {
    if (progress >= 1) return this.path[this.path.length - 1]
    const targetDistance = this.pathLength * progress
    let travelled = 0
    for (let i = 1; i < this.path.length; i++) {
      const from = this.path[i - 1]
      const to = this.path[i]
      const segmentLength = Math.hypot(to.x - from.x, to.z - from.z)
      if (travelled + segmentLength >= targetDistance) {
        const t = segmentLength > 0 ? (targetDistance - travelled) / segmentLength : 1
        return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }
      }
      travelled += segmentLength
    }
    return this.path[0]
  }

  /** Libera la plaza si se abandona la sesión antes de terminar (al salir de la pantalla). */
  release() {
    this.seat.taken = false
  }
}

export type SeatAction = 'sentarse' | 'levantarse'

/** Qué acción ofrece ahora la tecla de interactuar (o ninguna). */
export function seatPrompt(session: SeatSession | null, nearSeat: Seat | null): SeatAction | null {
  if (session) return session.phase === 'sentado' ? 'levantarse' : null
  return nearSeat ? 'sentarse' : null
}
