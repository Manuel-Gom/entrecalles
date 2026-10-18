import { describe, expect, it } from 'vitest'
import type { Box } from './collision'
import { NpcBrain, TalkPair, seatsFor, type Activity } from './brain'
import { generateCity, makeRng } from './layout'

const city = generateCity()
const DT = 0.05
const start = { x: city.nav[10].x, z: city.nav[10].z }

const distanceToBox = (x: number, z: number, box: Box) =>
  Math.hypot(x - Math.min(Math.max(x, box.minX), box.maxX), z - Math.min(Math.max(z, box.minZ), box.maxZ))
const clearance = (x: number, z: number) => Math.min(...city.obstacles.map((box) => distanceToBox(x, z, box)))
const nearest = <T extends { x: number; z: number }>(items: T[], brain: { x: number; z: number }) =>
  items.reduce((best, item) => (Math.hypot(item.x - brain.x, item.z - brain.z) < Math.hypot(best.x - brain.x, best.z - brain.z) ? item : best))

function solo(primary: Activity, seed = 1) {
  return new NpcBrain(city, { seed, primary, start, seats: seatsFor(city) })
}

function simulate(brains: NpcBrain[], seconds: number, onStep: (time: number) => void = () => undefined) {
  for (let time = 0; time < seconds; time += DT) {
    for (const brain of brains) brain.update(DT, time)
    onStep(time)
  }
}

describe('seatsFor', () => {
  const seats = seatsFor(city)

  it('hay dos plazas por banco, también en los del parque', () => {
    expect(seats).toHaveLength(city.benches.length * 2)
    expect(seats.every((seat) => !seat.taken)).toBe(true)
  })

  it('el punto de aproximación está en la acera, libre y de cara al banco', () => {
    for (const seat of seats) {
      expect(clearance(seat.approach.x, seat.approach.z)).toBeGreaterThan(0.25)
      // desde la aproximación, el banco queda en la dirección contraria a hacia donde mira quien se sienta
      const toSeat = { x: seat.x - seat.approach.x, z: seat.z - seat.approach.z }
      expect(toSeat.x * Math.sin(seat.yaw) + toSeat.z * Math.cos(seat.yaw)).toBeLessThan(0)
    }
  })
})

describe('NpcBrain', () => {
  it('quien pasea camina por las aceras, despacio, sin pisar nada', () => {
    const brain = solo('pasear')
    let maxSpeed = 0
    simulate([brain], 600, () => {
      maxSpeed = Math.max(maxSpeed, brain.speed)
      expect(clearance(brain.x, brain.z)).toBeGreaterThan(0.2)
    })
    expect(maxSpeed).toBeGreaterThan(1)
    expect(maxSpeed).toBeLessThan(1.7)
    expect(brain.completed).toBeGreaterThan(3)
  })

  it('quien corre va rápido y no se detiene entre trayectos', () => {
    const brain = solo('correr')
    let slowFrames = 0
    let maxSpeed = 0
    simulate([brain], 300, (time) => {
      maxSpeed = Math.max(maxSpeed, brain.speed)
      if (time > 5 && brain.speed < 2.5) slowFrames++
      expect(clearance(brain.x, brain.z)).toBeGreaterThan(0.2)
    })
    expect(maxSpeed).toBeGreaterThan(3)
    // solo puede frenar un instante en las esquinas del grafo, nunca pararse
    expect(slowFrames).toBeLessThan((295 / DT) * 0.15)
    expect(brain.completed).toBeGreaterThan(2)
  })

  it('quien se sienta llega al banco, se asienta en su plaza, aguanta y se levanta', () => {
    const seats = seatsFor(city)
    const brain = new NpcBrain(city, { seed: 4, primary: 'sentarse', start, seats })
    let sat: { x: number; z: number } | null = null
    let takenWhileSeated = false
    let stoodAgain = false
    simulate([brain], 400, () => {
      if (brain.sit > 0.99 && !sat) {
        sat = { x: brain.x, z: brain.z }
        takenWhileSeated = seats.some((seat) => seat.taken && Math.hypot(seat.x - brain.x, seat.z - brain.z) < 0.01)
      }
      if (sat && brain.sit === 0 && brain.activity !== 'sentarse') stoodAgain = true
    })
    expect(sat).not.toBeNull()
    expect(takenWhileSeated).toBe(true)
    expect(stoodAgain).toBe(true)
    expect(brain.completed).toBeGreaterThanOrEqual(2)
  })

  it('al levantarse deja la plaza libre para otros', () => {
    const seats = seatsFor(city)
    const brain = new NpcBrain(city, { seed: 4, primary: 'sentarse', start, seats })
    let sat = false
    let freedAfterStanding = false
    simulate([brain], 400, () => {
      const taken = seats.filter((seat) => seat.taken).length
      if (brain.sit > 0.99) {
        sat = true
        expect(taken).toBe(1)
      } else if (sat && brain.activity === 'pasear' && brain.phase === 'camino') {
        // ya se ha levantado y se va a pasear: nadie ocupa ninguna plaza
        expect(taken).toBe(0)
        freedAfterStanding = true
      }
    })
    expect(freedAfterStanding).toBe(true)
  })

  it('sentado no se mueve y mira hacia donde mira el banco', () => {
    const seats = seatsFor(city)
    const brain = new NpcBrain(city, { seed: 4, primary: 'sentarse', start, seats })
    const seen: { x: number; z: number; yaw: number }[] = []
    let finished = false
    simulate([brain], 300, () => {
      // solo la primera vez que se sienta (luego pasea y puede sentarse en otro banco)
      if (brain.sit > 0.99 && !finished) seen.push({ x: brain.x, z: brain.z, yaw: brain.yaw })
      else if (seen.length > 0) finished = true
    })
    expect(seen.length).toBeGreaterThan(20)
    for (const s of seen) {
      expect(s.x).toBeCloseTo(seen[0].x, 6)
      expect(s.z).toBeCloseTo(seen[0].z, 6)
    }
    const seat = nearest(seats, seen[0])
    expect(Math.hypot(seat.x - seen[0].x, seat.z - seen[0].z)).toBeLessThan(0.01)
    expect(Math.cos(seen[0].yaw - seat.yaw)).toBeGreaterThan(0.9)
  })

  it('dos personas no se sientan en la misma plaza', () => {
    const seats = seatsFor(city)
    const a = new NpcBrain(city, { seed: 11, primary: 'sentarse', start, seats })
    const b = new NpcBrain(city, { seed: 12, primary: 'sentarse', start: { x: city.nav[20].x, z: city.nav[20].z }, seats })
    simulate([a, b], 600, () => {
      if (a.sit > 0.99 && b.sit > 0.99) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5)
    })
  })

  it('quien espera se queda quieto en una esquina', () => {
    const brain = solo('esperar', 8)
    let waited = false
    simulate([brain], 300, () => {
      if (brain.doing && brain.activity === 'esperar' && brain.speed === 0) {
        waited = true
        const corner = nearest(city.corners, brain)
        expect(Math.hypot(corner.x - brain.x, corner.z - brain.z)).toBeLessThan(0.3)
      }
    })
    expect(waited).toBe(true)
  })

  it('quien mira un escaparate se queda quieto frente a la fachada', () => {
    const brain = solo('escaparate', 9)
    let looked = false
    simulate([brain], 300, () => {
      if (brain.doing && brain.activity === 'escaparate' && brain.speed === 0) {
        looked = true
        const spot = nearest(city.windows, brain)
        expect(Math.hypot(spot.x - brain.x, spot.z - brain.z)).toBeLessThan(0.3)
        expect(Math.cos(brain.yaw - spot.yaw)).toBeGreaterThan(0.8)
      }
    })
    expect(looked).toBe(true)
  })

  it('es determinista: misma semilla, mismo recorrido', () => {
    const a = solo('pasear', 5)
    const b = solo('pasear', 5)
    simulate([a, b], 120)
    expect({ x: a.x, z: a.z, yaw: a.yaw }).toEqual({ x: b.x, z: b.z, yaw: b.yaw })
  })

  it('con una actividad que necesita pareja pero sin ella, pasea', () => {
    const brain = new NpcBrain(city, { seed: 2, primary: 'charlar', start, seats: [] })
    simulate([brain], 200)
    expect(brain.completed).toBeGreaterThan(0)
  })
})

describe('TalkPair', () => {
  function pair(seed = 3) {
    const shared = new TalkPair(city, makeRng(seed))
    const seats = seatsFor(city)
    const a = new NpcBrain(city, { seed: 21, primary: 'charlar', start, seats, pair: shared, pairIndex: 0 })
    const b = new NpcBrain(city, { seed: 22, primary: 'charlar', start: { x: city.nav[40].x, z: city.nav[40].z }, seats, pair: shared, pairIndex: 1 })
    return { shared, a, b }
  }

  it('se reúnen, se miran y hablan a la vez', () => {
    const { a, b } = pair()
    let talking = false
    simulate([a, b], 400, () => {
      if (a.talk > 0.99 && b.talk > 0.99) {
        talking = true
        const distance = Math.hypot(a.x - b.x, a.z - b.z)
        expect(distance).toBeGreaterThan(1)
        expect(distance).toBeLessThan(1.5)
        // cada uno mira hacia el otro
        const towardsB = Math.atan2(b.x - a.x, b.z - a.z)
        expect(Math.cos(a.yaw - towardsB)).toBeGreaterThan(0.9)
        expect(Math.cos(b.yaw - (towardsB + Math.PI))).toBeGreaterThan(0.9)
      }
    })
    expect(talking).toBe(true)
  })

  it('al terminar la charla se van juntos a otro sitio y vuelven a hablar', () => {
    const { shared, a, b } = pair()
    const spots = new Set<string>()
    simulate([a, b], 900, () => {
      if (a.talk > 0.99 && b.talk > 0.99) spots.add(`${shared.spot.x.toFixed(1)},${shared.spot.z.toFixed(1)}`)
    })
    expect(spots.size).toBeGreaterThanOrEqual(2)
    expect(shared.version).toBeGreaterThanOrEqual(1)
  })

  it('la charla no empieza hasta que llegan los dos', () => {
    const { shared } = pair()
    expect(shared.ready).toBe(false)
    shared.arrive(0)
    expect(shared.ready).toBe(false)
    expect(shared.endsAt).toBeNull()
    shared.arrive(1)
    expect(shared.ready).toBe(true)
    expect(shared.endsAt).toBeGreaterThan(1 + 17)
  })
})

describe('evitación entre actores', () => {
  const RADIUS = 0.25

  /** Simula a todos juntos: cada uno ve a los demás (y al jugador, si lo hay) como círculos. */
  function crowd(brains: NpcBrain[], seconds: number, extra: { id: number; x: number; z: number; r: number }[] = [], onStep: (time: number, circles: { id: number; x: number; z: number; r: number }[]) => void = () => undefined) {
    const circles = [...extra, ...brains.map((b) => ({ id: b.id, x: b.x, z: b.z, r: RADIUS }))]
    for (let time = 0; time < seconds; time += DT) {
      brains.forEach((brain, i) => {
        brain.update(DT, time, circles)
        circles[extra.length + i].x = brain.x
        circles[extra.length + i].z = brain.z
      })
      onStep(time, circles)
    }
  }

  function walkers(count: number, primaries: Activity[]) {
    const seats = seatsFor(city)
    const occupied = new Set<(typeof city.corners)[number]>()
    return Array.from({ length: count }, (_, i) => {
      const node = city.nav[(i * 7 + 3) % city.nav.length]
      return new NpcBrain(city, { id: i, seed: 100 + i * 13, primary: primaries[i % primaries.length], start: { x: node.x, z: node.z }, seats, occupied })
    })
  }

  it('12 vecinos a la vez no se atraviesan ni se meten en las paredes', () => {
    const brains = walkers(12, ['pasear', 'correr', 'pasear', 'sentarse', 'esperar', 'escaparate'])
    let closest = Infinity
    crowd(brains, 600, [], () => {
      for (let i = 0; i < brains.length; i++) {
        const a = brains[i]
        if (a.phase === 'camino') expect(clearance(a.x, a.z), `vecino ${i} dentro de un obstáculo`).toBeGreaterThan(0.1)
        for (let j = i + 1; j < brains.length; j++) {
          const b = brains[j]
          // dos sentados en el mismo banco, o una pareja hablando, están cerca a propósito
          if (a.sit > 0.5 || b.sit > 0.5) continue
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z))
        }
      }
    })
    expect(closest).toBeGreaterThan(0.3)
  })

  it('ninguno se queda parado para siempre: todos acaban actividades', () => {
    const brains = walkers(12, ['pasear', 'correr', 'pasear', 'sentarse', 'esperar', 'escaparate'])
    crowd(brains, 900)
    for (const brain of brains) expect(brain.completed, `vecino ${brain.id}`).toBeGreaterThan(1)
  })

  it('el grupo es determinista', () => {
    const a = walkers(8, ['pasear', 'correr'])
    const b = walkers(8, ['pasear', 'correr'])
    crowd(a, 200)
    crowd(b, 200)
    expect(a.map((n) => [n.x, n.z])).toEqual(b.map((n) => [n.x, n.z]))
  })

  it('rodea a alguien parado en medio de la acera sin tocarlo, o busca otro camino', () => {
    const brain = solo('pasear', 31)
    let blocker: { id: number; x: number; z: number; r: number } | null = null
    let placed = false
    let closest = Infinity
    let passed = false
    for (let time = 0; time < 300; time += DT) {
      brain.update(DT, time, blocker ? [blocker] : [])
      if (!placed && brain.speed > 1.1 && brain.phase === 'camino') {
        // alguien se para a 2 m por delante, justo en su camino
        blocker = { id: 99, x: brain.x + Math.sin(brain.yaw) * 2, z: brain.z + Math.cos(brain.yaw) * 2, r: 0.3 }
        placed = true
      }
      if (blocker) {
        closest = Math.min(closest, Math.hypot(brain.x - blocker.x, brain.z - blocker.z))
        const along = (brain.x - blocker.x) * Math.sin(brain.yaw) + (brain.z - blocker.z) * Math.cos(brain.yaw)
        if (along > 1.5) passed = true
      }
    }
    expect(placed).toBe(true)
    expect(closest).toBeGreaterThan(0.35)
    expect(passed || brain.replans > 0).toBe(true)
  })

  it('el jugador parado en la acera también se esquiva', () => {
    const brain = solo('pasear', 41)
    const player = { id: -1, x: 0, z: 0, r: 0.3 }
    let closest = Infinity
    for (let time = 0; time < 300; time += DT) {
      // el jugador está siempre 1,5 m por delante de donde va el vecino
      player.x = brain.x + Math.sin(brain.yaw) * 1.5
      player.z = brain.z + Math.cos(brain.yaw) * 1.5
      brain.update(DT, time, [player])
      closest = Math.min(closest, Math.hypot(brain.x - player.x, brain.z - player.z))
    }
    expect(closest).toBeGreaterThan(0.3)
  })

  it('dos que esperan no ocupan la misma esquina', () => {
    let both = 0
    for (let pair = 0; pair < 8; pair++) {
      const occupied = new Set<(typeof city.corners)[number]>()
      const seats = seatsFor(city)
      const a = new NpcBrain(city, { id: 1, seed: 5 + pair, primary: 'esperar', start, seats, occupied })
      const b = new NpcBrain(city, { id: 2, seed: 60 + pair, primary: 'esperar', start: { x: city.nav[30].x, z: city.nav[30].z }, seats, occupied })
      crowd([a, b], 900, [], () => {
        if (a.doing && b.doing && a.activity === 'esperar' && b.activity === 'esperar') {
          both++
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1)
        }
      })
      // al terminar, los sitios se liberan: nunca hay más reservas que personas
      expect(occupied.size).toBeLessThanOrEqual(2)
    }
    expect(both).toBeGreaterThan(0)
  })

  it('un banco reservado por quien replanifica queda libre', () => {
    const seats = seatsFor(city)
    const brain = new NpcBrain(city, { id: 1, seed: 7, primary: 'sentarse', start, seats })
    expect(seats.filter((seat) => seat.taken)).toHaveLength(1) // reserva al elegir
    // un obstáculo inmóvil que lo bloquea fuerza el replanificado
    const wall: { id: number; x: number; z: number; r: number }[] = []
    for (let time = 0; time < 120 && brain.replans === 0; time += DT) {
      brain.update(DT, time, wall)
      if (wall.length === 0 && brain.speed > 0.8) wall.push({ id: 50, x: brain.x + Math.sin(brain.yaw) * 0.45, z: brain.z + Math.cos(brain.yaw) * 0.45, r: 0.3 })
    }
    // haya replanificado o no, nunca queda más de una plaza reservada
    expect(seats.filter((seat) => seat.taken).length).toBeLessThanOrEqual(1)
  })
})
