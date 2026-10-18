import { resolveCircle, type Box, type Circle, type Vec2 } from './collision'
import { findPath, makeRng, nearestNode, type CityLayout, type Rng, type Spot } from './layout'
import { nearestAngle } from './player'

export type Activity = 'pasear' | 'correr' | 'sentarse' | 'charlar' | 'esperar' | 'escaparate'

export const ACTIVITY_LABELS: Record<Activity, string> = {
  pasear: 'Pasea',
  correr: 'Hace footing',
  sentarse: 'Descansa en un banco',
  charlar: 'Charla',
  esperar: 'Espera en la esquina',
  escaparate: 'Mira un escaparate',
}

const JOG_SPEED = 3.4
const STROLL_SPEED = 1.25
export const NPC_RADIUS = 0.25
/** A partir de qué distancia un peatón empieza a esquivar a otro, y a qué distancia entre cuerpos se separan a la fuerza. */
const AVOID_RANGE = 2
const HARD_GAP = 0.2
/** Si lleva tanto tiempo sin avanzar, replanifica. */
const STUCK_SECONDS = 4

/** Plaza en un banco: quien se sienta se acerca desde `approach` (en la acera) y se asienta en (x, z) mirando a `yaw`. */
export interface Seat extends Spot {
  approach: Vec2
  /** waypoints por los que pasa el personaje para entrar y salir sin atravesar el respaldo */
  route?: Vec2[]
  /** colisionador del propio asiento, que solo se puede ignorar al ocupar su volumen final */
  collider?: Box
  taken: boolean
  /** por dónde se llega: por delante (un banco, de cara a él) o por detrás (una silla con mesa delante) */
  entry: 'delante' | 'detras'
  /** altura de la superficie del asiento (m) */
  height: number
}

/** Altura del asiento de un banco de calle. */
export const BENCH_SEAT_HEIGHT = 0.46

/** Una plaza en (x, z) mirando a `yaw`, con su punto de acercamiento a `distance` metros por delante o por detrás. */
export function makeSeat(x: number, z: number, yaw: number, entry: Seat['entry'] = 'delante', distance = 1.4, height = BENCH_SEAT_HEIGHT): Seat {
  const sign = entry === 'delante' ? 1 : -1
  return { x, z, yaw, entry, height, taken: false, approach: { x: x + Math.sin(yaw) * distance * sign, z: z + Math.cos(yaw) * distance * sign } }
}

/** Plazas de todos los bancos (dos por banco), con el punto desde el que se acercan. */
export function seatsFor(layout: CityLayout): Seat[] {
  const seats: Seat[] = []
  for (const bench of layout.benches) {
    const dirX = Math.sin(bench.yaw)
    const dirZ = Math.cos(bench.yaw)
    for (const side of [-0.4, 0.4]) {
      // se reparten a lo largo del banco (perpendicular a la dirección en que se mira)
      const x = bench.x + dirZ * side
      const z = bench.z - dirX * side
      seats.push(makeSeat(x, z, bench.yaw))
    }
  }
  return seats
}

/** Dos personas que charlan: caminan juntas de un sitio a otro y se paran a hablar. */
export class TalkPair {
  /** ocupantes que ya han llegado a su sitio */
  arrived = 0
  /** momento (s) en que acaba la charla actual; null si aún no ha empezado */
  endsAt: number | null = null
  spot: Spot
  version = 0
  readonly size = 2
  private readonly layout: CityLayout
  private readonly rng: Rng
  constructor(layout: CityLayout, rng: Rng) {
    this.layout = layout
    this.rng = rng
    this.spot = this.pick()
  }

  private pick(): Spot {
    const spots = this.layout.talk
    return spots[Math.floor(this.rng() * spots.length)]
  }

  private slotPosition(index: number): Vec2 {
    // a lo largo de la acera: perpendicular a la dirección "hacia la calle"
    const side = index === 0 ? -0.65 : 0.65
    return { x: this.spot.x + Math.cos(this.spot.yaw) * side, z: this.spot.z - Math.sin(this.spot.yaw) * side }
  }

  /** El sitio de cada uno (0 o 1), a un lado y otro del punto de charla, mirándose. */
  slot(index: number): Spot {
    const { x, z } = this.slotPosition(index)
    const other = this.slotPosition(index === 0 ? 1 : 0)
    return { x, z, yaw: Math.atan2(other.x - x, other.z - z) }
  }

  arrive(time: number) {
    this.arrived++
    if (this.arrived >= this.size && this.endsAt === null) this.endsAt = time + 18 + this.rng() * 22
  }

  get ready() {
    return this.arrived >= this.size
  }

  /** Cuando termina la charla, el primero que lo nota elige otro sitio para todos. */
  next(time: number) {
    if (this.endsAt !== null && time >= this.endsAt) {
      this.spot = this.pick()
      this.arrived = 0
      this.endsAt = null
      this.version++
    }
  }
}

type Phase = 'camino' | 'llegando' | 'haciendo' | 'levantandose'

export interface BrainOptions {
  /** identifica a este PNJ entre los demás actores (el jugador es -1) */
  id?: number
  seed: number
  /** actividad principal; entre una y otra pasea */
  primary: Activity
  start: Vec2
  seats: Seat[]
  pair?: TalkPair
  pairIndex?: number
  /** sitios (esquinas y escaparates) ya ocupados por alguien: nadie más se pone encima */
  occupied?: Set<Spot>
}

/** Qué hace un PNJ: elige un sitio, va por las aceras, hace su actividad un rato y vuelve a empezar. */
export class NpcBrain {
  x: number
  z: number
  yaw = 0
  speed = 0
  sit = 0
  talk = 0
  activity: Activity
  phase: Phase = 'camino'
  /** cuántas actividades ha terminado (para las pruebas) */
  completed = 0

  private route: Vec2[] = []
  private moveSpeed = STROLL_SPEED
  private goalYaw: number | null = null
  private timer = 0
  private duration = 0
  private seat: Seat | null = null
  private seatFrom: Vec2 = { x: 0, z: 0 }
  private lastPairVersion = 0
  private readonly rng: Rng
  private readonly primary: Activity
  private wantPrimary = true
  private spot: Spot | null = null
  private blockedFor = 0
  /** cuántas veces se ha tenido que replanificar por quedarse atascado (para las pruebas) */
  replans = 0
  readonly id: number

  private readonly layout: CityLayout
  private readonly options: BrainOptions

  constructor(layout: CityLayout, options: BrainOptions) {
    this.layout = layout
    this.options = options
    this.id = options.id ?? 0
    this.rng = makeRng(options.seed)
    this.x = options.start.x
    this.z = options.start.z
    this.yaw = this.rng() * Math.PI * 2
    this.primary = options.primary
    this.activity = options.primary === 'charlar' ? 'charlar' : 'pasear'
    this.chooseGoal()
  }

  /** Altura del asiento en el que está (o va a sentarse). */
  get seatHeight(): number {
    return this.seat?.height ?? BENCH_SEAT_HEIGHT
  }

  /** ¿Está dedicado a su actividad (no solo de camino)? */
  get doing(): boolean {
    return this.phase === 'haciendo' || this.phase === 'levantandose'
  }

  private routeTo(target: Vec2, final: Vec2 | null = null) {
    const from = nearestNode(this.layout.nav, this.x, this.z)
    const to = nearestNode(this.layout.nav, target.x, target.z)
    const points: Vec2[] = findPath(this.layout.nav, from.id, to.id).map((node) => ({ x: node.x, z: node.z }))
    // si ya estamos casi en el primer nodo, no hace falta volver a él
    if (points.length > 1 && Math.hypot(points[0].x - this.x, points[0].z - this.z) < 0.4) points.shift()
    this.route = points
    this.route.push(target)
    if (final) this.route.push(final)
  }

  private chooseGoal() {
    const { layout } = this
    this.releaseReservations()
    this.phase = 'camino'
    this.goalYaw = null
    this.duration = 0
    this.timer = 0
    const activity = this.nextActivity()
    this.activity = activity
    this.moveSpeed = activity === 'correr' ? JOG_SPEED : STROLL_SPEED + this.rng() * 0.3

    switch (activity) {
      case 'sentarse': {
        const free = this.options.seats.filter((seat) => !seat.taken)
        const seat = free[Math.floor(this.rng() * free.length)]
        if (!seat) return this.fallbackStroll()
        seat.taken = true
        this.seat = seat
        this.routeTo(seat.approach)
        this.goalYaw = seat.yaw
        this.duration = 25 + this.rng() * 30
        break
      }
      case 'charlar': {
        const pair = this.options.pair
        if (!pair) return this.fallbackStroll()
        const slot = pair.slot(this.options.pairIndex ?? 0)
        this.lastPairVersion = pair.version
        this.routeTo(slot)
        this.goalYaw = slot.yaw
        break
      }
      case 'esperar': {
        const spot = this.freeSpot(layout.corners)
        if (!spot) return this.fallbackStroll()
        this.routeTo(spot)
        this.goalYaw = spot.yaw
        this.duration = 8 + this.rng() * 10
        break
      }
      case 'escaparate': {
        const spot = this.freeSpot(layout.windows)
        if (!spot) return this.fallbackStroll()
        this.routeTo(spot)
        this.goalYaw = spot.yaw
        this.duration = 10 + this.rng() * 14
        break
      }
      default:
        this.fallbackStroll(activity === 'correr')
    }
  }

  /** Elige al azar un sitio de la lista que nadie tenga y lo reserva. */
  private freeSpot(spots: readonly Spot[]): Spot | null {
    const occupied = this.options.occupied
    const free = occupied ? spots.filter((spot) => !occupied.has(spot)) : spots
    const spot = free[Math.floor(this.rng() * free.length)]
    if (!spot) return null
    occupied?.add(spot)
    this.spot = spot
    return spot
  }

  /** Suelta el banco o el sitio que tuviera apartado sin haberlo usado (al replanificar). */
  private releaseReservations() {
    if (this.seat && this.sit === 0) {
      this.seat.taken = false
      this.seat = null
    }
    if (this.spot) {
      this.options.occupied?.delete(this.spot)
      this.spot = null
    }
  }

  private fallbackStroll(run = false) {
    const nodes = this.layout.nav
    // para pasear o correr se elige un nodo lejano, para que el trayecto sea largo
    let goal = nodes[Math.floor(this.rng() * nodes.length)]
    for (let i = 0; i < 4; i++) {
      const candidate = nodes[Math.floor(this.rng() * nodes.length)]
      if (Math.hypot(candidate.x - this.x, candidate.z - this.z) > Math.hypot(goal.x - this.x, goal.z - this.z)) goal = candidate
    }
    this.activity = run ? 'correr' : 'pasear'
    this.moveSpeed = run ? JOG_SPEED : STROLL_SPEED + this.rng() * 0.3
    this.routeTo({ x: goal.x, z: goal.z })
    this.goalYaw = null
    this.duration = run ? 0 : this.rng() * 3
    this.seat = null
  }

  private nextActivity(): Activity {
    const primary = this.primary
    if (primary === 'pasear' || primary === 'correr') return primary
    if (primary === 'charlar') return 'charlar'
    // alterna su actividad con un paseo
    const result: Activity = this.wantPrimary ? primary : 'pasear'
    this.wantPrimary = !this.wantPrimary
    return result
  }

  /** `time`: segundos desde que empezó el mundo (compartido por todos, para sincronizar las charlas). */
  update(dt: number, time: number, neighbors: readonly Circle[] = []) {
    const { options } = this
    options.pair?.next(time)

    if (this.phase === 'camino') {
      this.follow(dt, neighbors)
      return
    }
    // quieto
    this.speed += (0 - this.speed) * (1 - Math.exp(-10 * dt))
    if (this.speed < 0.02) this.speed = 0

    if (this.phase === 'llegando') {
      if (this.goalYaw !== null) this.turnTo(this.goalYaw, dt, 7)
      this.timer += dt
      const facing = this.goalYaw === null || Math.abs(nearestAngle(this.goalYaw, this.yaw) - this.yaw) < 0.12
      if (facing || this.timer > 1.5) {
        this.timer = 0
        if (this.activity === 'charlar') options.pair?.arrive(time)
        if (this.activity === 'sentarse' && this.seat) this.seatFrom = { x: this.x, z: this.z }
        this.phase = 'haciendo'
      }
      return
    }

    if (this.phase === 'haciendo') {
      this.timer += dt
      if (this.activity === 'sentarse' && this.seat) {
        this.sit = Math.min(1, this.sit + dt / 0.9)
        const t = this.sit * this.sit * (3 - 2 * this.sit)
        this.x = this.seatFrom.x + (this.seat.x - this.seatFrom.x) * t
        this.z = this.seatFrom.z + (this.seat.z - this.seatFrom.z) * t
        if (this.timer >= this.duration) this.phase = 'levantandose'
      } else if (this.activity === 'charlar') {
        const pair = options.pair
        this.talk = Math.min(1, this.talk + dt * 2)
        if (pair && pair.version !== this.lastPairVersion) {
          this.talk = 0
          this.finishActivity()
        }
      } else if (this.timer >= this.duration) {
        this.finishActivity()
      }
      return
    }

    // levantándose
    if (this.seat) {
      this.sit = Math.max(0, this.sit - dt / 0.9)
      const t = this.sit * this.sit * (3 - 2 * this.sit)
      this.x = this.seatFrom.x + (this.seat.x - this.seatFrom.x) * t
      this.z = this.seatFrom.z + (this.seat.z - this.seatFrom.z) * t
      if (this.sit === 0) {
        this.seat.taken = false
        this.seat = null
        this.finishActivity()
      }
    } else {
      this.finishActivity()
    }
  }

  private finishActivity() {
    this.completed++
    if (this.spot) {
      this.options.occupied?.delete(this.spot)
      this.spot = null
    }
    this.talk = 0
    this.chooseGoal()
  }

  private turnTo(yaw: number, dt: number, rate: number) {
    const desired = nearestAngle(yaw, this.yaw)
    this.yaw += (desired - this.yaw) * (1 - Math.exp(-rate * dt))
  }

  private follow(dt: number, neighbors: readonly Circle[]) {
    const next = this.route[0]
    if (!next) {
      if (this.activity === 'correr') {
        // el corredor no se detiene: enlaza un trayecto con el siguiente
        this.completed++
        this.chooseGoal()
        return
      }
      this.phase = 'llegando'
      this.timer = 0
      return
    }
    const dx = next.x - this.x
    const dz = next.z - this.z
    const distance = Math.hypot(dx, dz)
    const last = this.route.length === 1
    let dirX = distance > 1e-4 ? dx / distance : 0
    let dirZ = distance > 1e-4 ? dz / distance : 0

    // esquivar: cada peatón se aparta hacia su derecha (así dos que se cruzan no se bloquean) y frena si hay alguien delante
    let steerX = 0
    let steerZ = 0
    let pushX = 0
    let pushZ = 0
    let slow = 1
    const rightX = -dirZ
    const rightZ = dirX
    for (const other of neighbors) {
      if (other.id === this.id) continue
      const rx = other.x - this.x
      const rz = other.z - this.z
      const d = Math.hypot(rx, rz)
      if (d > AVOID_RANGE) continue
      const gapLimit = NPC_RADIUS + other.r + HARD_GAP
      if (d < gapLimit) {
        // demasiado cerca: se separan, empujando a quien se mueve (el que está quieto no cede)
        const away = d > 1e-6 ? { x: -rx / d, z: -rz / d } : { x: rightX, z: rightZ }
        pushX += away.x * (gapLimit - d)
        pushZ += away.z * (gapLimit - d)
      }
      const ahead = rx * dirX + rz * dirZ
      if (ahead <= 0) continue
      const lateral = dirX * rz - dirZ * rx // positivo = a mi derecha
      const gap = Math.abs(lateral)
      if (gap < 0.9) {
        const side = lateral > 0.15 ? -1 : 1
        const weight = (1 - d / AVOID_RANGE) * (1 - gap / 0.9)
        steerX += rightX * side * weight * 1.6
        steerZ += rightZ * side * weight * 1.6
        if (gap < 0.6 && ahead < 1.3) slow = Math.min(slow, Math.min(1, Math.max(0.2, (ahead - 0.45) / 0.85)))
      }
    }
    dirX += steerX
    dirZ += steerZ
    const length = Math.hypot(dirX, dirZ)
    if (length > 1e-6) {
      dirX /= length
      dirZ /= length
    }

    // frena al acercarse al último punto, salvo quien corre
    const braking = last && this.activity !== 'correr'
    const wanted = (braking ? Math.min(this.moveSpeed, 0.4 + distance * 1.8) : this.moveSpeed) * slow
    this.speed += (wanted - this.speed) * (1 - Math.exp(-5 * dt))
    const fromX = this.x
    const fromZ = this.z
    const step = Math.min(distance, this.speed * dt)
    this.x += dirX * step + pushX * Math.min(1, dt * 6)
    this.z += dirZ * step + pushZ * Math.min(1, dt * 6)
    // las aceras están libres, pero esquivar puede sacarlo de ellas: las paredes y el mobiliario lo devuelven
    const clear = resolveCircle({ x: this.x, z: this.z }, NPC_RADIUS, this.layout.obstacles)
    this.x = clear.x
    this.z = clear.z
    const moved = Math.hypot(this.x - fromX, this.z - fromZ)
    if (moved > 1e-4 && step > 1e-4) this.turnTo(Math.atan2(this.x - fromX, this.z - fromZ), dt, 9)

    if (distance - step < 0.08 || (!last && distance < 0.3)) this.route.shift()

    // atascado (alguien parado en medio, una pared...): se busca otro destino
    if (distance > 0.3 && moved < 0.15 * this.moveSpeed * dt) this.blockedFor += dt
    else this.blockedFor = Math.max(0, this.blockedFor - dt)
    if (this.blockedFor > STUCK_SECONDS) {
      this.blockedFor = 0
      this.replans++
      this.chooseGoal()
    }
  }
}
