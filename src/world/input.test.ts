import { describe, expect, it } from 'vitest'
import { Edges, IDLE_FRAME, STICK_DEADZONE, deadzone, mergeMove, padKind, padLabels, pickPad, readPad, type PadLike } from './input'
import { FrameStats, formatDiagnostics } from './perf'

/** Un mando inventado con todo en reposo; `set` cambia lo que haga falta. */
function pad(set: { axes?: number[]; pressed?: number[]; values?: Record<number, number> } = {}, extra: Partial<PadLike> = {}): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: Boolean(set.pressed?.includes(i)), value: set.values?.[i] ?? (set.pressed?.includes(i) ? 1 : 0) }))
  const axes = [0, 0, 0, 0]
  set.axes?.forEach((value, i) => (axes[i] = value))
  return { id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', mapping: 'standard', connected: true, axes, buttons, ...extra }
}

describe('deadzone', () => {
  it('ignora lo que no llega a la zona muerta', () => {
    expect(deadzone(0.1, 0.1, STICK_DEADZONE)).toEqual([0, 0])
    expect(deadzone(0, -0.2, STICK_DEADZONE)).toEqual([0, 0])
  })

  it('reescala el resto: justo fuera de la zona muerta casi 0 y a tope 1', () => {
    const [small] = deadzone(0.25, 0, STICK_DEADZONE)
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(0.1)
    expect(deadzone(1, 0, STICK_DEADZONE)[0]).toBeCloseTo(1)
  })

  it('es radial: conserva la dirección y no pasa de 1 en las diagonales', () => {
    const [x, y] = deadzone(0.9, 0.9, STICK_DEADZONE)
    expect(x).toBeCloseTo(y)
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe('readPad', () => {
  it('sin mando o desconectado no hace nada', () => {
    expect(readPad(null)).toBe(IDLE_FRAME)
    expect(readPad(pad({ axes: [1, 1] }, { connected: false }))).toBe(IDLE_FRAME)
  })

  it('en reposo, nada activo (el drift pequeño de las palancas se ignora)', () => {
    const frame = readPad(pad({ axes: [0.08, -0.05, 0.08, 0.1] }))
    expect(frame).toMatchObject({ moveX: 0, moveZ: 0, lookX: 0, lookY: 0, run: false, active: false })
  })

  it('la palanca izquierda mueve: arriba (Y negativo) es hacia delante y es proporcional', () => {
    expect(readPad(pad({ axes: [0, -1] })).moveZ).toBeCloseTo(1)
    expect(readPad(pad({ axes: [0, 1] })).moveZ).toBeCloseTo(-1)
    expect(readPad(pad({ axes: [1, 0] })).moveX).toBeCloseTo(1)
    const half = readPad(pad({ axes: [0, -0.6] })).moveZ
    expect(half).toBeGreaterThan(0.3)
    expect(half).toBeLessThan(0.7)
  })

  it('la palanca derecha gira la cámara', () => {
    const frame = readPad(pad({ axes: [0, 0, 0.8, -0.5] }))
    expect(frame.lookX).toBeGreaterThan(0.5)
    expect(frame.lookY).toBeLessThan(0)
    expect(frame.moveX).toBe(0)
  })

  it('la cruceta mueve a velocidad completa', () => {
    expect(readPad(pad({ pressed: [12] }))).toMatchObject({ moveZ: 1, moveX: 0 })
    expect(readPad(pad({ pressed: [14] }))).toMatchObject({ moveX: -1 })
    expect(readPad(pad({ pressed: [13, 15] }))).toMatchObject({ moveZ: -1, moveX: 1 })
  })

  it('si se usan palanca y cruceta a la vez, gana la que más empuja', () => {
    expect(readPad(pad({ axes: [0, -0.5], pressed: [12] })).moveZ).toBe(1)
    expect(readPad(pad({ axes: [0, -1], pressed: [12] })).moveZ).toBeCloseTo(1)
  })

  it('correr: gatillo derecho a partir de un umbral, o pulsar la palanca (L3)', () => {
    expect(readPad(pad({ values: { 7: 0.2 } })).run).toBe(false)
    expect(readPad(pad({ values: { 7: 0.6 } })).run).toBe(true)
    expect(readPad(pad({ pressed: [10] })).run).toBe(true)
  })

  it('A interactúa, B vuelve, Start pausa y LB/RB acercan y alejan la cámara', () => {
    expect(readPad(pad({ pressed: [0] })).interact).toBe(true)
    expect(readPad(pad({ pressed: [1] })).back).toBe(true)
    expect(readPad(pad({ pressed: [9] })).pause).toBe(true)
    expect(readPad(pad({ pressed: [4] })).zoom).toBe(-1)
    expect(readPad(pad({ pressed: [5] })).zoom).toBe(1)
    expect(readPad(pad({ pressed: [4, 5] })).zoom).toBe(0)
  })

  it('"active" avisa de que se está tocando el mando', () => {
    expect(readPad(pad({ pressed: [0] })).active).toBe(true)
    expect(readPad(pad({ axes: [0, 0, 0.9, 0] })).active).toBe(true)
  })

  it('tolera mandos con menos botones o ejes de los esperados', () => {
    const short: PadLike = { id: 'x', mapping: '', connected: true, axes: [], buttons: [] }
    expect(readPad(short)).toMatchObject({ moveX: 0, moveZ: 0, active: false })
  })
})

describe('padKind y padLabels', () => {
  it('reconoce los mandos de PlayStation y Xbox por su nombre', () => {
    expect(padKind('054c-0ce6-Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation')
    expect(padKind('DualSense Wireless Controller')).toBe('playstation')
    expect(padKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox')
    expect(padKind('Logitech F310')).toBe('otro')
  })

  it('cada mando nombra sus botones', () => {
    expect(padLabels('playstation')).toMatchObject({ run: 'R2', pause: 'Options' })
    expect(padLabels('xbox')).toMatchObject({ run: 'RT', interact: 'A' })
    expect(padLabels('otro').interact).toBe('A')
  })
})

describe('pickPad', () => {
  it('elige el primer mando conectado y salta los huecos', () => {
    const a = pad({}, { id: 'a' })
    expect(pickPad([null, pad({}, { connected: false }), a])).toBe(a)
    expect(pickPad([null, null])).toBeNull()
    expect(pickPad(null)).toBeNull()
  })
})

describe('Edges', () => {
  it('solo devuelve true al pulsar, no mientras se mantiene', () => {
    const edges = new Edges()
    expect([false, true, true, true, false, true].map((isDown) => edges.press('a', isDown))).toEqual([false, true, false, false, false, true])
  })

  it('cada botón va por separado y reset olvida el estado', () => {
    const edges = new Edges()
    expect(edges.press('a', true)).toBe(true)
    expect(edges.press('b', true)).toBe(true)
    edges.reset()
    expect(edges.press('a', true)).toBe(true)
  })
})

describe('mergeMove', () => {
  it('suma teclado y mando sin pasar de 1', () => {
    expect(mergeMove({ x: 0, z: 0 }, { x: 0.3, z: 0.4 })).toEqual({ x: 0.3, z: 0.4 })
    const both = mergeMove({ x: 1, z: 0 }, { x: 1, z: 0 })
    expect(Math.hypot(both.x, both.z)).toBeCloseTo(1)
  })

  it('el teclado y el mando se anulan si empujan en sentidos contrarios', () => {
    expect(mergeMove({ x: 0, z: 1 }, { x: 0, z: -1 })).toEqual({ x: 0, z: 0 })
  })
})

describe('FrameStats y diagnóstico', () => {
  it('vacío no da datos inventados', () => {
    expect(new FrameStats().summary()).toEqual({ frames: 0, fps: 0, avgMs: 0, p99Ms: 0, worstMs: 0 })
  })

  it('calcula FPS medios, el 1 % más lento y el peor', () => {
    const stats = new FrameStats()
    for (let i = 0; i < 99; i++) stats.record(10)
    stats.record(50)
    const s = stats.summary()
    expect(s.frames).toBe(100)
    expect(s.avgMs).toBeCloseTo(10.4)
    expect(s.fps).toBeCloseTo(1000 / 10.4)
    expect(s.p99Ms).toBe(50)
    expect(s.worstMs).toBe(50)
  })

  it('solo guarda las últimas muestras', () => {
    const stats = new FrameStats(10)
    for (let i = 0; i < 10; i++) stats.record(100)
    for (let i = 0; i < 10; i++) stats.record(10)
    expect(stats.summary()).toMatchObject({ frames: 10, avgMs: 10 })
  })

  it('ignora valores inválidos y se puede reiniciar', () => {
    const stats = new FrameStats()
    stats.record(NaN)
    stats.record(-3)
    stats.record(0)
    expect(stats.summary().frames).toBe(0)
    stats.record(16)
    stats.reset()
    expect(stats.summary().frames).toBe(0)
  })

  it('el texto del diagnóstico incluye lo necesario para comparar mediciones', () => {
    const text = formatDiagnostics({
      summary: { frames: 300, fps: 100, avgMs: 10, p99Ms: 14, worstMs: 20 },
      quality: 'alta', width: 1920, height: 1080, pixelRatio: 1, device: 'Mando Xbox', gpu: 'Intel UHD', triangles: 600000, calls: 118, npcs: 16,
    })
    for (const part of ['100', 'alta', '1920×1080', 'Mando Xbox', 'Intel UHD', '118', '16 vecinos']) expect(text).toContain(part)
  })
})
