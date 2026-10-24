import { describe, expect, it, vi } from 'vitest'
import { AudioEngine, attenuation, mixGains, panFor, stepVolume, strikeCount, surfaceAt } from './audio'
import { BLOCK_PITCH, RING_WALK, STREET_CENTERS } from './layout'

describe('surfaceAt', () => {
  it('dentro de un edificio es baldosa', () => {
    expect(surfaceAt(0, 400, true)).toBe('baldosa')
  })

  it('en la acera que rodea cada manzana es acera, en la calzada es calzada, y el parque es hierba', () => {
    expect(surfaceAt(0, RING_WALK, false)).toBe('acera') // la acera del parque
    expect(surfaceAt(-BLOCK_PITCH + RING_WALK, -BLOCK_PITCH, false)).toBe('acera')
    expect(surfaceAt(BLOCK_PITCH / 2, BLOCK_PITCH / 2, false)).toBe('calzada') // el cruce entre manzanas
    expect(surfaceAt(8, 8, false)).toBe('hierba')
    expect(surfaceAt(-8, 6, false)).toBe('hierba')
  })

  it('los paseos del parque son de acera', () => {
    expect(surfaceAt(0.5, 8, false)).toBe('acera')
    expect(surfaceAt(-9, 0.4, false)).toBe('acera')
  })

  it('fuera de las manzanas, calzada', () => {
    expect(surfaceAt(STREET_CENTERS[3], 0, false)).toBe('calzada')
    expect(surfaceAt(0, STREET_CENTERS[0], false)).toBe('calzada')
  })
})

describe('strikeCount', () => {
  it('cuenta los pasos al pasar por 0,25 (pie izquierdo) y 0,75 (derecho)', () => {
    expect(strikeCount(0.2, 0.3)).toBe(1)
    expect(strikeCount(0.7, 0.8)).toBe(1)
    expect(strikeCount(0.3, 0.7)).toBe(0)
    expect(strikeCount(0.1, 0.9)).toBe(2)
  })

  it('con la fase dando la vuelta (de 0,95 a 0,05) no hay paso, y de 0,7 a 0,3 hay dos', () => {
    expect(strikeCount(0.95, 0.05)).toBe(0)
    expect(strikeCount(0.7, 0.3)).toBe(2)
  })

  it('cuenta el instante exacto una sola vez', () => {
    expect(strikeCount(0.2, 0.25)).toBe(1)
    expect(strikeCount(0.25, 0.3)).toBe(0)
  })

  it('en un ciclo completo hay exactamente dos pasos', () => {
    let steps = 0
    let phase = 0.1
    for (let i = 0; i < 1000; i++) {
      const next = (phase + 0.001) % 1
      steps += strikeCount(phase, next)
      phase = next
    }
    expect(steps).toBe(2)
  })

  it('sin movimiento no hay pasos', () => {
    expect(strikeCount(0.25, 0.25)).toBe(0)
    expect(strikeCount(0.5, 0.5)).toBe(0)
  })
})

describe('attenuation, stepVolume, panFor y mixGains', () => {
  it('el sonido baja con la distancia hasta callar a la distancia máxima', () => {
    expect(attenuation(0)).toBe(1)
    expect(attenuation(7)).toBeCloseTo(0.25)
    expect(attenuation(14)).toBe(0)
    expect(attenuation(100)).toBe(0)
    expect(attenuation(3)).toBeGreaterThan(attenuation(6))
    expect(attenuation(-2)).toBe(1)
  })

  it('correr suena más fuerte que andar y no pasa de 1', () => {
    expect(stepVolume(4.6)).toBeGreaterThan(stepVolume(1.5))
    expect(stepVolume(50)).toBe(1)
    expect(stepVolume(0)).toBeGreaterThan(0)
  })

  it('el sonido de la derecha de la pantalla va al canal derecho', () => {
    // la cámara en +z mirando a -z: la derecha de la pantalla es +x
    expect(panFor(5, 0, 0)).toBeGreaterThan(0.8)
    expect(panFor(-5, 0, 0)).toBeLessThan(-0.8)
    expect(Math.abs(panFor(0, -5, 0))).toBeLessThan(1e-9) // justo delante
    // con la cámara girada media vuelta, se invierte
    expect(panFor(5, 0, Math.PI)).toBeLessThan(-0.8)
    expect(panFor(0.1, 0.1, 0)).toBe(0)
  })

  it('el volumen general multiplica al de ambiente y al de efectos', () => {
    expect(mixGains({ master: 100, music: 50, effects: 100 })).toEqual({ ambience: 0.5, effects: 1 })
    expect(mixGains({ master: 50, music: 50, effects: 80 })).toEqual({ ambience: 0.25, effects: 0.4 })
    expect(mixGains({ master: 0, music: 100, effects: 100 })).toEqual({ ambience: 0, effects: 0 })
    expect(mixGains({ master: 250, music: -5, effects: 100 })).toEqual({ ambience: 0, effects: 1 })
  })
})

/** Un AudioContext de mentira que anota lo que se le pide. */
function fakeContext(state: 'running' | 'suspended' = 'running') {
  const calls = { created: [] as string[], gains: [] as { node: string; value: number }[], started: 0 }
  const param = (label: string) => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn((value: number) => calls.gains.push({ node: label, value })),
  })
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    calls.created.push(kind)
    return { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(() => calls.started++), stop: vi.fn(), ...extra }
  }
  const ctx = {
    state,
    currentTime: 1,
    sampleRate: 8000,
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = 'running'
    }),
    suspend: vi.fn(async () => {
      ctx.state = 'suspended'
    }),
    close: vi.fn(async () => undefined),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createGain: () => node('gain', { gain: param('gain') }),
    createBiquadFilter: () => node('filter', { frequency: { value: 0 }, Q: { value: 0 }, type: '' }),
    createBufferSource: () => node('source', { playbackRate: { value: 1 }, buffer: null, loop: false }),
    createOscillator: () => node('osc', { frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, type: '' }),
    createStereoPanner: () => node('panner', { pan: param('pan') }),
  }
  return { ctx, calls }
}

describe('AudioEngine', () => {
  const volumes = { master: 80, music: 65, effects: 80 }
  const engine = (state: 'running' | 'suspended' = 'running') => {
    const { ctx, calls } = fakeContext(state)
    return { audio: new AudioEngine(volumes, () => ctx as unknown as AudioContext), ctx, calls }
  }

  it('sin contexto de audio (navegador sin Web Audio) todo es seguro y no hace nada', () => {
    const audio = new AudioEngine(volumes, () => null)
    audio.unlock()
    expect(audio.state).toBe('none')
    expect(() => {
      audio.step('acera', false, 1)
      audio.event('puerta')
      audio.setBabble(1, 0)
      audio.setEnvironment('interior')
      audio.setVolumes(volumes)
      audio.suspend()
      audio.resume()
      audio.dispose()
    }).not.toThrow()
  })

  it('no crea el contexto hasta que se pide (el navegador exige un gesto del usuario)', () => {
    const { audio, calls } = engine()
    expect(audio.state).toBe('none')
    expect(calls.created).toHaveLength(0)
    audio.unlock()
    expect(audio.state).toBe('running')
    expect(calls.created.length).toBeGreaterThan(10)
    const created = calls.created.length
    audio.unlock() // pedirlo otra vez no lo reconstruye
    expect(calls.created.length).toBe(created)
    audio.dispose()
  })

  it('si el navegador lo deja suspendido, se anota que está suspendido y se reanuda', async () => {
    const { audio, ctx } = engine('suspended')
    audio.unlock()
    expect(ctx.resume).toHaveBeenCalled()
    await Promise.resolve()
    expect(audio.state).toBe('running')
    audio.dispose()
  })

  it('cuenta los pasos y los eventos pedidos, y con el audio suspendido no sintetiza nada', () => {
    const { audio, ctx, calls } = engine()
    audio.unlock()
    ctx.state = 'suspended'
    const before = calls.created.length
    audio.step('hierba', false, 1)
    audio.event('puerta')
    expect(audio.counters).toMatchObject({ steps: 1, events: 1, lastSurface: 'hierba', lastEvent: 'puerta' })
    expect(calls.created.length).toBe(before)
    audio.dispose()
  })

  it('con el audio activo, cada paso y cada evento crea sonidos', () => {
    const { audio, calls } = engine()
    audio.unlock()
    const before = calls.created.length
    audio.step('acera', true, 0.8, -0.3)
    const afterStep = calls.created.length
    expect(afterStep).toBeGreaterThan(before)
    audio.event('sentarse')
    expect(calls.created.length).toBeGreaterThan(afterStep)
    audio.dispose()
  })

  it('un paso muy lejano (volumen casi cero) no se sintetiza, pero se cuenta', () => {
    const { audio, calls } = engine()
    audio.unlock()
    const before = calls.created.length
    audio.step('calzada', false, 0.005)
    expect(calls.created.length).toBe(before)
    expect(audio.counters.steps).toBe(1)
    audio.dispose()
  })

  it('todas las superficies y eventos suenan sin fallar', () => {
    const { audio } = engine()
    audio.unlock()
    for (const surface of ['acera', 'calzada', 'hierba', 'baldosa'] as const) expect(() => audio.step(surface, surface === 'acera', 0.7)).not.toThrow()
    for (const name of ['puerta', 'sentarse', 'levantarse'] as const) expect(() => audio.event(name)).not.toThrow()
    audio.dispose()
  })

  it('los ajustes de volumen se aplican a los buses de efectos y de ambiente', () => {
    const { audio, calls } = engine()
    audio.unlock()
    calls.gains.length = 0
    audio.setVolumes({ master: 50, music: 100, effects: 0 })
    const values = calls.gains.map((g) => g.value)
    expect(values).toContain(0.5) // ambiente: 0,5 × 1
    expect(values).toContain(0) // efectos: 0,5 × 0
    audio.dispose()
  })

  it('al entrar en un edificio el ambiente pasa de la calle al café, y vuelve', () => {
    const { audio, calls } = engine()
    audio.unlock()
    calls.gains.length = 0
    audio.setEnvironment('interior')
    expect(audio.environment).toBe('interior')
    expect(calls.gains.map((g) => g.value)).toEqual([0, 0.5])
    calls.gains.length = 0
    audio.setEnvironment('interior') // repetirlo no hace nada
    expect(calls.gains).toHaveLength(0)
    audio.setEnvironment('calle')
    expect(calls.gains.map((g) => g.value)).toEqual([0.5, 0])
    audio.dispose()
  })

  it('el murmullo sube con el nivel y se acota entre 0 y 1', () => {
    const { audio, calls } = engine()
    audio.unlock()
    calls.gains.length = 0
    audio.setBabble(5, 0.4)
    const loud = calls.gains.find((g) => g.node === 'gain')!.value
    calls.gains.length = 0
    audio.setBabble(-1, 0)
    const quiet = calls.gains.find((g) => g.node === 'gain')!.value
    expect(loud).toBeCloseTo(0.35)
    expect(quiet).toBe(0)
    audio.dispose()
  })

  it('al liberarlo cierra el contexto y no vuelve a crearlo', () => {
    const { audio, ctx } = engine()
    audio.unlock()
    audio.dispose()
    expect(ctx.close).toHaveBeenCalled()
    audio.unlock()
    expect(audio.state).toBe('none')
  })

  it('suspender y reanudar llegan al contexto', () => {
    const { audio, ctx } = engine()
    audio.unlock()
    audio.suspend()
    expect(ctx.suspend).toHaveBeenCalled()
    audio.resume()
    expect(ctx.resume).toHaveBeenCalledTimes(2)
    audio.dispose()
  })

  it('en pausa, una tecla o un clic no reactivan el sonido (el desbloqueo del navegador no lo reanuda)', async () => {
    const { audio, ctx } = engine()
    audio.unlock()
    audio.suspend()
    await Promise.resolve()
    audio.unlock()
    await Promise.resolve()
    expect(audio.state).toBe('suspended')
    audio.resume()
    await Promise.resolve()
    expect(audio.state).toBe('running')
    audio.dispose()
    expect(ctx.close).toHaveBeenCalled()
  })

  it('si se pausa antes de que exista el contexto, nace suspendido', async () => {
    const { audio } = engine()
    audio.suspend()
    audio.unlock()
    await Promise.resolve()
    expect(audio.state).toBe('suspended')
    audio.resume()
    await Promise.resolve()
    expect(audio.state).toBe('running')
    audio.dispose()
  })

  it('mantiene un único temporizador de acentos y lo libera al salir', async () => {
    vi.useFakeTimers()
    try {
      const { audio } = engine()
      audio.unlock()
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(vi.getTimerCount()).toBe(1)
      audio.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
