import { describe, expect, it } from 'vitest'
import { boxAt, type Circle } from './collision'
import { RUN_SPEED, WALK_SPEED } from './gait'
import { PLAYER_RADIUS, nearestAngle, newPlayer, stepPlayer, type PlayerInput } from './player'

const walkForward: PlayerInput = { moveX: 0, moveZ: 1, run: false }

function run(state: ReturnType<typeof newPlayer>, input: PlayerInput, seconds: number, cameraYaw = 0, obstacles = [] as ReturnType<typeof boxAt>[], actors = [] as Circle[]) {
  for (let t = 0; t < seconds; t += 1 / 60) stepPlayer(state, input, cameraYaw, 1 / 60, obstacles, actors)
}

describe('stepPlayer', () => {
  it('sin entrada se queda quieto', () => {
    const p = newPlayer(3, 4, 0)
    run(p, { moveX: 0, moveZ: 0, run: false }, 1)
    expect(p).toMatchObject({ x: 3, z: 4, speed: 0 })
  })

  it('"adelante" va hacia donde mira la cámara (cámara en +z mirando a -z: avanza en -z)', () => {
    const p = newPlayer(0, 0, 0)
    run(p, walkForward, 1, 0)
    expect(p.z).toBeLessThan(-1)
    expect(Math.abs(p.x)).toBeLessThan(1e-6)
  })

  it('con la cámara girada, "adelante" gira con ella', () => {
    const p = newPlayer(0, 0, 0)
    run(p, walkForward, 1, Math.PI / 2) // cámara en +x mirando a -x
    expect(p.x).toBeLessThan(-1)
    expect(Math.abs(p.z)).toBeLessThan(1e-6)
  })

  it('"derecha" es la derecha de la pantalla', () => {
    const p = newPlayer(0, 0, 0)
    run(p, { moveX: 1, moveZ: 0, run: false }, 1, 0)
    expect(p.x).toBeGreaterThan(1)
  })

  it('andando se acerca a la velocidad de paseo y corriendo a la de carrera', () => {
    const walking = newPlayer(0, 0, 0)
    run(walking, walkForward, 2)
    expect(walking.speed).toBeGreaterThan(WALK_SPEED * 0.95)
    expect(walking.speed).toBeLessThanOrEqual(WALK_SPEED + 0.01)
    const running = newPlayer(0, 0, 0)
    run(running, { ...walkForward, run: true }, 2)
    expect(running.speed).toBeGreaterThan(RUN_SPEED * 0.95)
    expect(running.speed).toBeLessThanOrEqual(RUN_SPEED + 0.01)
  })

  it('en diagonal no es más rápido que recto', () => {
    const diagonal = newPlayer(0, 0, 0)
    run(diagonal, { moveX: 1, moveZ: 1, run: false }, 2)
    expect(diagonal.speed).toBeLessThanOrEqual(WALK_SPEED + 0.01)
  })

  it('acelera y frena de forma gradual, no de golpe', () => {
    const p = newPlayer(0, 0, 0)
    stepPlayer(p, walkForward, 0, 1 / 60, [])
    expect(p.speed).toBeGreaterThan(0)
    expect(p.speed).toBeLessThan(WALK_SPEED * 0.5)
    run(p, walkForward, 1)
    stepPlayer(p, { moveX: 0, moveZ: 0, run: false }, 0, 1 / 60, [])
    expect(p.speed).toBeGreaterThan(WALK_SPEED * 0.5)
  })

  it('se vuelve hacia donde camina, por el camino corto', () => {
    const p = newPlayer(0, 0, Math.PI - 0.1)
    run(p, { moveX: -1, moveZ: 0, run: false }, 1) // hacia -x: ángulo -π/2 ≡ 3π/2
    expect(nearestAngle(-Math.PI / 2, p.yaw)).toBeCloseTo(p.yaw, 1)
  })

  it('no atraviesa una pared y se desliza por ella', () => {
    const wall = [boxAt(0, -3, 200, 1)] // pared larga delante (z -3.5..-2.5)
    const p = newPlayer(0, 0, 0)
    run(p, { moveX: 1, moveZ: 1, run: true }, 3, 0, wall)
    expect(p.z).toBeGreaterThanOrEqual(-2.5 + PLAYER_RADIUS - 1e-6)
    expect(p.x).toBeGreaterThan(1) // sigue avanzando de lado
  })

  it('contra una pared de frente, la velocidad real baja a cero', () => {
    const wall = [boxAt(0, -3, 200, 1)]
    const p = newPlayer(0, -1.5, 0)
    run(p, walkForward, 2, 0, wall)
    expect(p.speed).toBeLessThan(0.1)
  })
})

describe('contra otras personas', () => {
  it('no atraviesa a alguien que está parado en medio', () => {
    const person = [{ id: 3, x: 0, z: -3, r: 0.25 }]
    const p = newPlayer(0, 0, 0)
    run(p, walkForward, 4, 0, [], person)
    expect(Math.hypot(p.x - 0, p.z - -3)).toBeGreaterThanOrEqual(PLAYER_RADIUS + 0.25 - 1e-6)
  })

  it('lo rodea si empuja un poco de lado', () => {
    const person = [{ id: 3, x: 0, z: -3, r: 0.25 }]
    const p = newPlayer(0.2, 0, 0)
    run(p, walkForward, 6, 0, [], person)
    expect(p.z).toBeLessThan(-4) // ya lo ha pasado
  })

  it('un actor con el id del jugador no le estorba', () => {
    const self = [{ id: -1, x: 0, z: 0, r: 0.3 }]
    const p = newPlayer(0, 0, 0)
    run(p, walkForward, 1, 0, [], self)
    expect(p.z).toBeLessThan(-1)
  })
})

describe('nearestAngle', () => {
  it('elige el equivalente más cercano', () => {
    expect(nearestAngle(Math.PI * 2 + 0.1, 0)).toBeCloseTo(0.1)
    expect(nearestAngle(-3, 3)).toBeCloseTo(-3 + Math.PI * 2)
  })
})
