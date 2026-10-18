import { describe, expect, it } from 'vitest'
import { makeSeat, seatsFor } from './brain'
import { generateCity } from './layout'
import { SEAT_REACH, SeatSession, findSeat, makeSeatRoute, seatPrompt } from './seating'

const city = generateCity()
const fresh = () => seatsFor(city)

describe('findSeat', () => {
  it('encuentra la plaza libre más cercana por delante del banco', () => {
    const seats = fresh()
    const seat = seats[0]
    expect(findSeat(seats, seat.approach.x, seat.approach.z)).toBe(seat)
  })

  it('no la encuentra desde lejos', () => {
    const seats = fresh()
    const seat = seats[0]
    const far = { x: seat.x + Math.sin(seat.yaw) * (SEAT_REACH + 1), z: seat.z + Math.cos(seat.yaw) * (SEAT_REACH + 1) }
    expect(findSeat(seats, far.x, far.z)).toBeNull()
  })

  it('no se puede sentar uno por detrás del banco', () => {
    const seats = fresh()
    const seat = seats[0]
    const behind = { x: seat.x - Math.sin(seat.yaw) * 0.9, z: seat.z - Math.cos(seat.yaw) * 0.9 }
    expect(findSeat(seats, behind.x, behind.z)).toBeNull()
  })

  it('salta las plazas ocupadas y elige otra libre', () => {
    const seats = fresh()
    // las dos plazas de un banco están a 0,8 m una de otra: ocupar la más cercana deja la otra
    const [first, second] = seats
    const spot = first.approach
    first.taken = true
    expect(findSeat(seats, spot.x, spot.z)).toBe(second)
    second.taken = true
    expect(findSeat(seats, spot.x, spot.z)).toBeNull()
  })
})

describe('plazas a las que se llega por detrás (sillas)', () => {
  const chair = () => makeSeat(0, 0, Math.PI / 2, 'detras', 1)

  it('el punto de acercamiento está detrás de la silla', () => {
    const seat = chair()
    expect(seat.approach.x).toBeCloseTo(-1)
    expect(seat.approach.z).toBeCloseTo(0, 6)
  })

  it('se puede sentar quien está detrás, no quien está delante (donde estaría la mesa)', () => {
    const seat = chair()
    expect(findSeat([seat], -1, 0)).toBe(seat)
    expect(findSeat([seat], 1, 0)).toBeNull()
  })

  it('al levantarse sale por detrás de la silla', () => {
    const seat = chair()
    const s = new SeatSession(seat, seat.yaw)
    for (let t = 0; t < 1.2; t += 1 / 60) s.update(1 / 60)
    s.standUp()
    for (let t = 0; t < 1.2; t += 1 / 60) s.update(1 / 60)
    expect(s.x).toBeCloseTo(-1, 6)
  })
})

describe('SeatSession', () => {
  function session() {
    const seats = fresh()
    const seat = seats[0]
    const yawToSeat = Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z)
    return { seat, s: new SeatSession(seat, yawToSeat) }
  }
  const run = (s: SeatSession, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) s.update(1 / 60)
  }

  it('reserva la plaza al empezar y la libera al levantarse del todo', () => {
    const { seat, s } = session()
    expect(seat.taken).toBe(true)
    run(s, 1.2)
    expect(s.phase).toBe('sentado')
    expect(seat.taken).toBe(true)
    expect(s.standUp()).toBe(true)
    run(s, 1.2)
    expect(s.done).toBe(true)
    expect(seat.taken).toBe(false)
  })

  it('recorre la ruta sin saltos al sentarse y termina centrado en la plaza', () => {
    const { seat, s } = session()
    run(s, 0.45)
    expect(s.phase).toBe('sentandose')
    expect(s.sit).toBeGreaterThan(0.2)
    expect(s.sit).toBeLessThan(0.8)
    expect(Math.hypot(s.x - seat.approach.x, s.z - seat.approach.z)).toBeGreaterThan(0.1)
    expect(Math.hypot(s.x - seat.x, s.z - seat.z)).toBeGreaterThan(0.1)
    run(s, 0.7)
    expect(s.sit).toBe(1)
    expect(s.x).toBeCloseTo(seat.x, 6)
    expect(s.z).toBeCloseTo(seat.z, 6)
    expect(Math.cos(s.yaw - seat.yaw)).toBeGreaterThan(0.999)
  })

  it('empieza y termina en la posición real del jugador, recorriendo la ruta en ambos sentidos', () => {
    const { seat } = session()
    const from = { x: seat.approach.x + 0.25, z: seat.approach.z }
    const s = new SeatSession(seat, seat.yaw, from)
    expect({ x: s.x, z: s.z }).toEqual(from)
    const advanceContinuously = (seconds: number) => {
      let previous = { x: s.x, z: s.z }
      for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
        s.update(1 / 60)
        expect(Math.hypot(s.x - previous.x, s.z - previous.z)).toBeLessThan(0.1)
        previous = { x: s.x, z: s.z }
      }
    }
    advanceContinuously(2)
    expect(s.phase).toBe('sentado')
    s.standUp()
    advanceContinuously(2)
    expect(s.done).toBe(true)
    expect(s.x).toBeCloseTo(from.x, 6)
    expect(s.z).toBeCloseTo(from.z, 6)
  })

  it('genera rutas laterales que terminan en el centro del asiento y no cruzan obstáculos', () => {
    const seat = makeSeat(0, 0, Math.PI / 2, 'detras', 1)
    const ownCollider = { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 }
    seat.collider = ownCollider
    const obstacle = { minX: 1, maxX: 2, minZ: -0.5, maxZ: 0.5 }
    const route = makeSeatRoute(seat, [ownCollider, obstacle], ownCollider)
    expect(route[0]).toEqual(seat.approach)
    expect(route.at(-1)).toEqual({ x: seat.x, z: seat.z })
  })

  it('no se puede levantar mientras se sienta', () => {
    const { s } = session()
    run(s, 0.3)
    expect(s.standUp()).toBe(false)
    expect(s.phase).toBe('sentandose')
  })

  it('empujar una dirección no lo levanta hasta llevar un rato sentado', () => {
    const { s } = session()
    run(s, 1.0) // acaba de sentarse
    expect(s.pushToStand()).toBe(false)
    run(s, 0.6)
    expect(s.pushToStand()).toBe(true)
  })

  it('al levantarse vuelve al punto de acercamiento, delante del banco', () => {
    const { seat, s } = session()
    run(s, 1.2)
    s.standUp()
    run(s, 0.45)
    expect(Math.hypot(s.x - seat.approach.x, s.z - seat.approach.z)).toBeGreaterThan(0.1)
    expect(Math.hypot(s.x - seat.x, s.z - seat.z)).toBeGreaterThan(0.1)
    run(s, 0.75)
    expect(s.x).toBeCloseTo(seat.approach.x, 6)
    expect(s.z).toBeCloseTo(seat.approach.z, 6)
    expect(s.sit).toBe(0)
  })

  it('release libera la plaza si se abandona a medias', () => {
    const { seat, s } = session()
    run(s, 0.3)
    s.release()
    expect(seat.taken).toBe(false)
  })

  it('update después de terminar no cambia nada', () => {
    const { s } = session()
    run(s, 1.2)
    s.standUp()
    run(s, 1.2)
    const { x, z } = s
    run(s, 1)
    expect({ x: s.x, z: s.z }).toEqual({ x, z })
  })
})

describe('seatPrompt', () => {
  it('ofrece sentarse cerca de una plaza, levantarse sentado y nada en medio de la transición', () => {
    const seats = fresh()
    expect(seatPrompt(null, seats[0])).toBe('sentarse')
    expect(seatPrompt(null, null)).toBeNull()
    const s = new SeatSession(seats[0], 0)
    expect(seatPrompt(s, null)).toBeNull()
    for (let t = 0; t < 1.2; t += 1 / 60) s.update(1 / 60)
    expect(seatPrompt(s, null)).toBe('levantarse')
    s.standUp()
    expect(seatPrompt(s, null)).toBeNull()
  })
})
