import { describe, expect, it } from 'vitest'
import { advanceGameClock, celestialPosition, celestialState, formatGameClock, lunarPhase, skyColors } from '../src/world/dayNight'

describe('ciclo solar', () => {
  it('avanza un minuto de juego por segundo real y muestra la hora en formato 24 h', () => {
    const start = new Date('2026-10-18T21:04:00+02:00')
    const next = advanceGameClock(start, 1)
    expect(formatGameClock(start)).toBe('21:04')
    expect(formatGameClock(next)).toBe('21:05')
    expect(formatGameClock(advanceGameClock(start, 60))).toBe('22:04')
  })

  it('rechaza un avance inválido del reloj', () => {
    expect(() => advanceGameClock(new Date(), -1)).toThrow(RangeError)
  })

  it('sitúa el sol sobre el horizonte durante el día y lo oculta de noche', () => {
    const day = celestialState(new Date('2025-06-21T12:00:00+02:00'))
    const night = celestialState(new Date('2025-06-21T00:00:00+02:00'))

    expect(day.sunAltitude).toBeGreaterThan(0)
    expect(day.daylight).toBeGreaterThan(0.9)
    expect(day.night).toBe(false)
    expect(night.sunAltitude).toBeLessThan(0)
    expect(night.daylight).toBeLessThan(0.1)
    expect(night.night).toBe(true)
  })

  it('mueve la luna en dirección opuesta al sol', () => {
    const state = celestialState(new Date('2025-03-20T18:00:00+01:00'))
    const dot = state.sunDirection.x * state.moonDirection.x + state.sunDirection.y * state.moonDirection.y + state.sunDirection.z * state.moonDirection.z
    expect(dot).toBeCloseTo(-1, 10)
  })

  it('elige cuatro diseños lunares a lo largo del mes sinódico', () => {
    const newMoon = Date.UTC(2000, 0, 6, 18, 14)
    const day = 86_400_000
    expect(lunarPhase(new Date(newMoon)).phase).toBe('nueva')
    expect(lunarPhase(new Date(newMoon + 7.38 * day)).phase).toBe('creciente')
    expect(lunarPhase(new Date(newMoon + 14.76 * day)).phase).toBe('llena')
    expect(lunarPhase(new Date(newMoon + 22.15 * day)).phase).toBe('menguante')
    expect(lunarPhase(new Date(newMoon + 7.38 * day)).illumination).toBeCloseTo(0.5, 1)
    expect(lunarPhase(new Date(newMoon + 14.76 * day)).illumination).toBeGreaterThan(0.99)
    expect(lunarPhase(new Date(newMoon)).illumination).toBeLessThan(0.01)
  })

  it('coloca los cuerpos celestes alrededor del jugador y cambia el color del cielo', () => {
    expect(celestialPosition({ x: 1, y: 0.5, z: 0 }, { x: 10, z: -4 }, 100)).toEqual({ x: 110, y: 51.45, z: -4 })
    expect(skyColors(1, 0.7).sky).toBe(0xbcd2e4)
    expect(skyColors(0, -0.5).sky).toBe(0x111d36)
  })
})
