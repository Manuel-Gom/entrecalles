import { describe, expect, it } from 'vitest'
import { RUN_SPEED, WALK_SPEED, ankleForward, computeGait, cyclesPerMeter, legExtent, runFactor, swingAmplitude, type GaitDims, type GaitInput } from './gait'

const dims: GaitDims = { thigh: 0.45, shin: 0.447, hipHeight: 0.97 }
const base: GaitInput = { phase: 0, speed: 0, sit: 0, talk: 0, time: 0, seed: 0 }
const pose = (input: Partial<GaitInput>) => computeGait({ ...base, ...input }, dims)

describe('zancada', () => {
  it('parado no mueve las piernas más que un leve cambio de peso', () => {
    const p = pose({ speed: 0, phase: 0.3, time: 5 })
    expect(Math.abs(p.thighL)).toBeLessThan(0.06)
    expect(Math.abs(p.kneeL)).toBeLessThan(0.12)
    expect(p.pelvisDrop).toBeCloseTo(0, 1)
  })

  it('andar es más amplio que casi parado, y correr más que andar', () => {
    expect(swingAmplitude(0.3)).toBeLessThan(swingAmplitude(WALK_SPEED))
    expect(swingAmplitude(WALK_SPEED)).toBeLessThan(swingAmplitude(RUN_SPEED))
    expect(runFactor(WALK_SPEED)).toBeLessThan(0.1)
    expect(runFactor(RUN_SPEED)).toBeGreaterThan(0.95)
  })

  it('las dos piernas van en oposición de fase', () => {
    for (const phase of [0.05, 0.2, 0.4, 0.6, 0.9]) {
      const p = pose({ speed: WALK_SPEED, phase })
      const q = pose({ speed: WALK_SPEED, phase: phase + 0.5 })
      expect(p.thighL).toBeCloseTo(q.thighR, 6)
      expect(p.kneeL).toBeCloseTo(q.kneeR, 6)
    }
  })

  it('el brazo de un lado va hacia atrás cuando su pierna va hacia delante', () => {
    const forward = pose({ speed: WALK_SPEED, phase: 0.25 }) // pierna izquierda al máximo hacia delante
    expect(forward.thighL).toBeLessThan(0)
    expect(forward.armL).toBeGreaterThan(0)
    expect(forward.armR).toBeLessThan(0)
  })

  it('la cadencia es realista: ~115 pasos/min andando y ~185 corriendo', () => {
    expect(WALK_SPEED * cyclesPerMeter(WALK_SPEED, dims) * 120).toBeGreaterThan(100)
    expect(WALK_SPEED * cyclesPerMeter(WALK_SPEED, dims) * 120).toBeLessThan(130)
    expect(RUN_SPEED * cyclesPerMeter(RUN_SPEED, dims) * 120).toBeGreaterThan(160)
    expect(RUN_SPEED * cyclesPerMeter(RUN_SPEED, dims) * 120).toBeLessThan(200)
  })

  it('el pie de apoyo no resbala: al andar retrocede a la velocidad del cuerpo (±35 %)', () => {
    const v = WALK_SPEED
    const cpm = cyclesPerMeter(v, dims)
    // apoyo de la pierna izquierda: del contacto delante (fase 0,25) a la salida detrás (0,75); se ignora el último tramo, donde despega
    const samples: number[] = []
    const N = 20
    for (let i = 2; i < 16; i++) {
      const p0 = 0.25 + (0.5 * i) / N
      const p1 = 0.25 + (0.5 * (i + 1)) / N
      const a = pose({ speed: v, phase: p0 })
      const b = pose({ speed: v, phase: p1 })
      const footSpeed = ((ankleForward(a.thighL, a.kneeL, dims) - ankleForward(b.thighL, b.kneeL, dims)) / (p1 - p0)) * v * cpm
      samples.push(footSpeed)
    }
    const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length
    expect(mean).toBeGreaterThan(v * 0.65)
    expect(mean).toBeLessThan(v * 1.35)
  })

  it('la pelvis baja lo justo para que la pierna de apoyo toque el suelo', () => {
    for (const speed of [WALK_SPEED, RUN_SPEED]) {
      for (let i = 0; i < 20; i++) {
        const p = pose({ speed, phase: i / 20 })
        const reach = dims.thigh + dims.shin
        const best = Math.max(legExtent(p.thighL, p.kneeL, dims), legExtent(p.thighR, p.kneeR, dims))
        // altura del tobillo de apoyo respecto a estar de pie: 0 si pisa el suelo; al correr hay un pequeño vuelo
        const clearance = p.pelvisDrop + (reach - best)
        const flight = speed === RUN_SPEED ? 0.04 : 0
        expect(clearance).toBeGreaterThanOrEqual(-1e-9)
        expect(clearance).toBeLessThanOrEqual(flight + 1e-9)
      }
    }
  })

  it('al correr el tronco se inclina hacia delante más que andando', () => {
    expect(pose({ speed: RUN_SPEED, phase: 0.1 }).spineLean).toBeGreaterThan(pose({ speed: WALK_SPEED, phase: 0.1 }).spineLean + 0.1)
  })

  it('sentado: pelvis a la altura del asiento, piernas por delante y brazos relajados', () => {
    for (const seatHeight of [0.46, 0.47, 0.67]) {
      const p = pose({ sit: 1, seatHeight })
      expect(p.thighL).toBeCloseTo(-1.61, 6)
      expect(p.kneeL).toBeGreaterThan(1.2)
      expect(dims.hipHeight + p.pelvisDrop).toBeCloseTo(seatHeight + 0.045, 3)
      expect(ankleForward(p.thighL, p.kneeL, dims)).toBeGreaterThan(0.4)
      expect(p.elbowL).toBeLessThan(0.2)
      expect(p.elbowR).toBeLessThan(0.2)
      expect(p.armOutL).toBeLessThan(0)
      expect(p.armOutR).toBeLessThan(0)
    }
  })

  it('sentarse es gradual: a medias queda entre de pie y sentado', () => {
    const standing = pose({ sit: 0 }).pelvisDrop
    const half = pose({ sit: 0.5 }).pelvisDrop
    const sitting = pose({ sit: 1 }).pelvisDrop
    expect(half).toBeLessThan(standing)
    expect(half).toBeGreaterThan(sitting)
  })

  it('hablando, el brazo derecho se levanta; en movimiento no gesticula', () => {
    const talking = pose({ talk: 1, time: 3 })
    const quiet = pose({ talk: 0, time: 3 })
    expect(talking.elbowR).toBeGreaterThan(quiet.elbowR + 0.5)
    const walking = pose({ talk: 1, speed: WALK_SPEED, phase: 0.2, time: 3 })
    const walkingQuiet = pose({ talk: 0, speed: WALK_SPEED, phase: 0.2, time: 3 })
    expect(walking.elbowR).toBeCloseTo(walkingQuiet.elbowR, 6)
  })

  it('todos los valores son finitos', () => {
    for (const speed of [0, 0.4, WALK_SPEED, 3, RUN_SPEED, 8]) {
      for (const sit of [0, 0.5, 1]) {
        for (const talk of [0, 1]) {
          const p = pose({ speed, sit, talk, phase: 0.77, time: 12.3, seed: 0.4 })
          for (const value of Object.values(p)) expect(Number.isFinite(value)).toBe(true)
        }
      }
    }
  })
})

describe('transiciones y giros', () => {
  /** Acelera de 0 a `to` m/s en `seconds`, integrando la fase por la distancia recorrida, y devuelve el mayor salto entre fotogramas. */
  function biggestJump(to: number, seconds: number, from = 0) {
    const dt = 1 / 60
    let phase = 0
    let previous: ReturnType<typeof pose> | null = null
    let biggest = 0
    for (let t = 0; t <= seconds; t += dt) {
      const speed = from + (to - from) * Math.min(1, t / seconds)
      phase = (phase + speed * dt * cyclesPerMeter(speed, dims)) % 1
      const p = pose({ speed, phase, time: t })
      if (previous) {
        for (const key of ['thighL', 'thighR', 'kneeL', 'kneeR', 'footL', 'footR', 'armL', 'armR', 'elbowL', 'elbowR', 'spineLean', 'pelvisDrop'] as const) {
          biggest = Math.max(biggest, Math.abs(p[key] - previous[key]))
        }
      }
      previous = p
    }
    return biggest
  }

  // al correr, las piernas se mueven rápido por sí solas: un cambio brusco es el que supera ese ritmo, no el que lo alcanza
  const steadyRun = biggestJump(RUN_SPEED, 2, RUN_SPEED)

  it('arrancar desde parado hasta correr no da saltos mayores que correr a ritmo constante', () => {
    expect(biggestJump(RUN_SPEED, 1.2)).toBeLessThan(steadyRun * 1.15)
  })

  it('frenar de correr a parar tampoco', () => {
    expect(biggestJump(0, 0.6, RUN_SPEED)).toBeLessThan(steadyRun * 1.15)
  })

  it('pasar de andar a correr es continuo', () => {
    expect(biggestJump(RUN_SPEED, 0.8, WALK_SPEED)).toBeLessThan(steadyRun * 1.15)
  })

  it('el ritmo constante al correr no es un salto de más de 0,3 rad por fotograma', () => {
    expect(steadyRun).toBeLessThan(0.3)
  })

  it('al girar en marcha el cuerpo se inclina hacia el lado de la curva, y más cuanto más rápido', () => {
    const left = pose({ speed: RUN_SPEED, phase: 0.1, turn: 3 })
    const right = pose({ speed: RUN_SPEED, phase: 0.1, turn: -3 })
    expect(left.spineRoll).toBeLessThan(0) // hacia la izquierda es negativo
    expect(right.spineRoll).toBeCloseTo(-left.spineRoll, 9)
    expect(Math.abs(pose({ speed: WALK_SPEED, phase: 0.1, turn: 3 }).spineRoll)).toBeLessThan(Math.abs(left.spineRoll))
    expect(left.headYaw).toBeGreaterThan(pose({ speed: RUN_SPEED, phase: 0.1, turn: 0 }).headYaw)
  })

  it('parado, girar no inclina el cuerpo, y la inclinación está acotada', () => {
    expect(pose({ speed: 0, turn: 5 }).spineRoll).toBeCloseTo(0, 9)
    expect(Math.abs(pose({ speed: RUN_SPEED, phase: 0.1, turn: 50 }).spineRoll)).toBeLessThanOrEqual(0.14 + 1e-9)
  })
})
