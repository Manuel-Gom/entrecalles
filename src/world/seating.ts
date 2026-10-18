import type { Seat } from './brain'
import type { Vec2 } from './collision'
import { nearestAngle } from './player'

/** Hasta qué distancia de una plaza se puede pulsar "sentarse". */
export const SEAT_REACH = 1.7
const TRANSITION_SECONDS = 0.9
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
  private readonly from: Vec2
  private readonly fromYaw: number

  constructor(seat: Seat, from: Vec2, yaw: number) {
    this.seat = seat
    seat.taken = true
    this.from = { x: from.x, z: from.z }
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
      this.progress = Math.min(1, this.progress + dt / TRANSITION_SECONDS)
      if (this.progress >= 1) this.phase = 'sentado'
    } else if (this.phase === 'sentado') {
      this.seatedFor += dt
    } else {
      this.progress = Math.max(0, this.progress - dt / TRANSITION_SECONDS)
      if (this.progress <= 0) {
        this.done = true
        this.seat.taken = false
      }
    }
    const t = ease(this.progress)
    this.sit = t
    // se sienta desde donde estaba; al levantarse sale por delante del banco
    const origin = this.phase === 'levantandose' || this.done ? this.seat.approach : this.from
    this.x = origin.x + (this.seat.x - origin.x) * t
    this.z = origin.z + (this.seat.z - origin.z) * t
    const target = nearestAngle(this.seat.yaw, this.fromYaw)
    this.yaw = this.phase === 'levantandose' ? this.seat.yaw : this.fromYaw + (target - this.fromYaw) * t
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
