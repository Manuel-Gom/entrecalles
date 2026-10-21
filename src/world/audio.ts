import { BLOCK_CENTERS, BLOCK_HALF, RING_OUTER } from './layout'

/* ---------- partes puras (se prueban sin navegador) ---------- */

export type Surface = 'acera' | 'calzada' | 'hierba' | 'baldosa'
export type Environment = 'calle' | 'interior'
export type SoundEvent = 'puerta' | 'sentarse' | 'levantarse'

/** Sobre qué se pisa en un punto de la calle (o 'baldosa' dentro de un edificio). */
export function surfaceAt(x: number, z: number, inside: boolean): Surface {
  if (inside) return 'baldosa'
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      const reach = Math.max(Math.abs(x - cx), Math.abs(z - cz))
      if (reach > RING_OUTER) continue
      if (reach >= BLOCK_HALF) return 'acera'
      // el centro del parque es hierba, salvo los dos paseos que lo cruzan
      if (cx === 0 && cz === 0) return Math.abs(x) < 1.2 || Math.abs(z) < 1.2 ? 'acera' : 'hierba'
      return 'acera' // dentro de un edificio no se llega, pero se da un valor
    }
  }
  return 'calzada'
}

/** Pasos que se dan al pasar la fase del ciclo de `prev` a `next`: el pie toca el suelo en 0,25 (izquierdo) y 0,75 (derecho). */
export function strikeCount(prev: number, next: number): number {
  const unwrapped = next < prev ? next + 1 : next // la fase vuelve a 0 al llegar a 1
  let count = 0
  for (const strike of [0.25, 0.75, 1.25, 1.75]) if (strike > prev && strike <= unwrapped) count++
  return count
}

/** 1 pegado a la fuente del sonido, 0 a `range` metros o más, con una caída suave. */
export function attenuation(distance: number, range = 14): number {
  if (distance >= range) return 0
  const t = 1 - Math.max(0, distance) / range
  return t * t
}

/** Volumen de un paso según la velocidad (andar suena más suave que correr). */
export function stepVolume(speed: number): number {
  return Math.min(1, 0.28 + speed * 0.14)
}

/** Posición en el campo estéreo (-1 izquierda, 1 derecha) de algo en (dx, dz) respecto al oyente, visto desde una cámara con ese giro. */
export function panFor(dx: number, dz: number, cameraYaw: number): number {
  const distance = Math.hypot(dx, dz)
  if (distance < 0.5) return 0
  // la derecha de la pantalla es (cos, -sin)
  const right = (dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw)) / distance
  return Math.max(-0.9, Math.min(0.9, right))
}

export interface Volumes {
  master: number
  music: number
  effects: number
}

/** De los ajustes (0-100) a ganancias (0-1): el volumen general multiplica a los otros dos. */
export function mixGains(volumes: Volumes): { ambience: number; effects: number } {
  const unit = (value: number) => Math.min(1, Math.max(0, value / 100))
  return { ambience: unit(volumes.master) * unit(volumes.music), effects: unit(volumes.master) * unit(volumes.effects) }
}

/* ---------- el motor de sonido (Web Audio): todo se sintetiza, sin archivos ---------- */

export type AudioState = 'none' | 'suspended' | 'running'

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/** Sonidos del barrio generados con Web Audio: pasos según el suelo, ambiente de calle o de café, puertas, asientos y murmullo. */
export class AudioEngine {
  /** lo que se ha pedido sonar, para las pruebas (cuenta aunque el navegador no deje sonar todavía) */
  readonly counters = { steps: 0, events: 0, lastSurface: null as Surface | null, lastEvent: null as SoundEvent | null }
  environment: Environment = 'calle'
  private ctx: AudioContext | null = null
  private volumes: Volumes
  private readonly makeContext: () => AudioContext | null
  private effectsBus: GainNode | null = null
  private ambienceBus: GainNode | null = null
  private streetGain: GainNode | null = null
  private interiorGain: GainNode | null = null
  private babbleGain: GainNode | null = null
  private babblePan: StereoPannerNode | null = null
  private white: AudioBuffer | null = null
  private accentTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** en pausa: ni un gesto del usuario debe reanudar el contexto */
  private held = false

  constructor(volumes: Volumes, makeContext?: () => AudioContext | null) {
    this.volumes = volumes
    this.makeContext =
      makeContext ??
      (() => {
        const Context = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
        return Context ? new Context() : null
      })
  }

  get state(): AudioState {
    if (!this.ctx) return 'none'
    return this.ctx.state === 'running' ? 'running' : 'suspended'
  }

  /** Crea el contexto de audio (el navegador solo lo permite tras un gesto del usuario) y lo reanuda. */
  unlock() {
    if (this.disposed) return
    if (!this.ctx) {
      try {
        this.ctx = this.makeContext()
      } catch {
        this.ctx = null
      }
      if (this.ctx) this.build(this.ctx)
    }
    // en pausa, un gesto del usuario crea el contexto pero no lo reanuda
    const action = this.held ? this.ctx?.suspend() : this.ctx?.resume()
    void action?.catch(() => undefined)
  }

  suspend() {
    this.held = true
    void this.ctx?.suspend().catch(() => undefined)
  }

  resume() {
    this.held = false
    if (this.ctx) void this.ctx.resume().catch(() => undefined)
  }

  setVolumes(volumes: Volumes) {
    this.volumes = volumes
    this.applyVolumes()
  }

  setEnvironment(environment: Environment) {
    if (this.environment === environment) return
    this.environment = environment
    this.applyEnvironment()
  }

  private applyVolumes() {
    const { ctx } = this
    if (!ctx || !this.effectsBus || !this.ambienceBus) return
    const gains = mixGains(this.volumes)
    this.effectsBus.gain.setTargetAtTime(gains.effects, ctx.currentTime, 0.05)
    this.ambienceBus.gain.setTargetAtTime(gains.ambience, ctx.currentTime, 0.05)
  }

  private applyEnvironment() {
    const { ctx } = this
    if (!ctx || !this.streetGain || !this.interiorGain) return
    const inside = this.environment === 'interior'
    this.streetGain.gain.setTargetAtTime(inside ? 0 : 0.5, ctx.currentTime, 0.3)
    this.interiorGain.gain.setTargetAtTime(inside ? 0.5 : 0, ctx.currentTime, 0.3)
  }

  /* --- construcción --- */

  private noise(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      } else data[i] = white
    }
    return buffer
  }

  private loop(ctx: AudioContext, buffer: AudioBuffer, filter: BiquadFilterNode): AudioBufferSourceNode {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(filter)
    source.start()
    return source
  }

  private build(ctx: AudioContext) {
    this.white = this.noise(ctx, 1)
    this.effectsBus = ctx.createGain()
    this.ambienceBus = ctx.createGain()
    this.effectsBus.connect(ctx.destination)
    this.ambienceBus.connect(ctx.destination)

    // calle: un zumbido grave de tráfico lejano que sube y baja despacio
    this.streetGain = ctx.createGain()
    const traffic = ctx.createBiquadFilter()
    traffic.type = 'lowpass'
    traffic.frequency.value = 320
    this.loop(ctx, this.noise(ctx, 4, true), traffic)
    traffic.connect(this.streetGain)
    this.streetGain.connect(this.ambienceBus)
    const swell = ctx.createOscillator()
    swell.frequency.value = 0.08
    const swellDepth = ctx.createGain()
    swellDepth.gain.value = 0.12
    swell.connect(swellDepth)
    swellDepth.connect(this.streetGain.gain)
    swell.start()

    // café: murmullo de sala (ruido entre 400 y 1500 Hz que respira despacio)
    this.interiorGain = ctx.createGain()
    this.interiorGain.gain.value = 0
    const room = ctx.createBiquadFilter()
    room.type = 'bandpass'
    room.frequency.value = 800
    room.Q.value = 0.5
    this.loop(ctx, this.white, room)
    room.connect(this.interiorGain)
    this.interiorGain.connect(this.ambienceBus)

    // murmullo de dos personas hablando: dos bandas de ruido con un ritmo de sílabas
    this.babbleGain = ctx.createGain()
    this.babbleGain.gain.value = 0
    this.babblePan = ctx.createStereoPanner()
    for (const [freq, q] of [[520, 2.2], [1500, 1.6]] as const) {
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = freq
      band.Q.value = q
      const voice = ctx.createGain()
      voice.gain.value = 0.5
      const syllables = ctx.createOscillator()
      syllables.frequency.value = freq < 1000 ? 4.3 : 5.7
      const depth = ctx.createGain()
      depth.gain.value = 0.45
      syllables.connect(depth)
      depth.connect(voice.gain)
      syllables.start()
      this.loop(ctx, this.white, band)
      band.connect(voice)
      voice.connect(this.babbleGain)
    }
    this.babbleGain.connect(this.babblePan)
    this.babblePan.connect(this.effectsBus)

    this.applyVolumes()
    this.applyEnvironment()
    this.scheduleAccents()
  }

  /** Pajaritos en la calle y tazas en el café, de vez en cuando. */
  private scheduleAccents() {
    const next = () => {
      if (this.disposed) return
      const delay = rand(3500, 9000)
      this.accentTimer = setTimeout(() => {
        this.accentTimer = null
        if (this.state === 'running') (this.environment === 'calle' ? this.chirp() : this.clink())
        next()
      }, delay)
    }
    next()
  }

  /* --- sonidos --- */

  private tone(type: OscillatorType, from: number, to: number, seconds: number, volume: number, when = 0, bus: AudioNode | null = this.ambienceBus) {
    const { ctx } = this
    if (!ctx || !bus) return
    const t = ctx.currentTime + when
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + seconds)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(volume, t + 0.01)
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    osc.connect(env)
    env.connect(bus)
    osc.start(t)
    osc.stop(t + seconds + 0.05)
  }

  private chirp() {
    const base = rand(2600, 3800)
    for (let i = 0; i < Math.floor(rand(2, 5)); i++) this.tone('sine', base, base * rand(0.8, 1.3), 0.09, 0.06, i * 0.13)
  }

  private clink() {
    const base = rand(2300, 3300)
    this.tone('sine', base, base * 0.98, 0.35, 0.05)
    this.tone('sine', base * 1.5, base * 1.49, 0.25, 0.03, 0.01)
  }

  /** Un golpe de ruido filtrado: la base de los pasos, el asiento y los clics. */
  private burst(filter: BiquadFilterType, freq: number, q: number, seconds: number, volume: number, pan = 0, when = 0) {
    const { ctx, white, effectsBus } = this
    if (!ctx || !white || !effectsBus) return
    const t = ctx.currentTime + when
    const source = ctx.createBufferSource()
    source.buffer = white
    source.playbackRate.value = rand(0.85, 1.2)
    const shape = ctx.createBiquadFilter()
    shape.type = filter
    shape.frequency.value = freq * rand(0.9, 1.1)
    shape.Q.value = q
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(volume, t + 0.006)
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    source.connect(shape)
    shape.connect(env)
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = pan
      env.connect(panner)
      panner.connect(effectsBus)
    } else env.connect(effectsBus)
    source.start(t, Math.random() * 0.5, seconds + 0.05)
  }

  /** Un paso. `volume` (0-1) ya incluye la distancia; `pan` va de -1 a 1. */
  step(surface: Surface, running: boolean, volume: number, pan = 0) {
    this.counters.steps++
    this.counters.lastSurface = surface
    if (this.state !== 'running' || volume <= 0.01) return
    const length = running ? 0.075 : 0.11
    switch (surface) {
      case 'acera':
        this.burst('bandpass', 1900, 0.9, length, 0.5 * volume, pan)
        break
      case 'calzada':
        this.burst('lowpass', 950, 0.7, length, 0.45 * volume, pan)
        break
      case 'hierba':
        this.burst('lowpass', 520, 0.6, length * 1.3, 0.3 * volume, pan)
        break
      case 'baldosa':
        this.burst('bandpass', 2700, 1.4, length * 0.9, 0.5 * volume, pan)
        break
    }
    // el peso del pie
    this.tone('sine', running ? 110 : 85, 45, 0.08, 0.16 * volume, 0, this.effectsBus)
  }

  event(name: SoundEvent) {
    this.counters.events++
    this.counters.lastEvent = name
    if (this.state !== 'running') return
    switch (name) {
      case 'puerta':
        // chirrido de bisagra y clic del pestillo
        this.tone('sawtooth', 210, 120, 0.4, 0.05, 0, this.effectsBus)
        this.burst('bandpass', 1200, 2, 0.4, 0.16)
        this.burst('bandpass', 3000, 3, 0.03, 0.3, 0, 0.42)
        break
      case 'sentarse':
        this.burst('lowpass', 420, 0.7, 0.18, 0.5)
        this.tone('sine', 90, 50, 0.16, 0.25, 0, this.effectsBus)
        break
      case 'levantarse':
        this.burst('lowpass', 500, 0.7, 0.14, 0.35)
        break
    }
  }

  /** Murmullo de la charla más cercana: `level` (0-1) ya incluye la distancia. */
  setBabble(level: number, pan: number) {
    const { ctx, babbleGain, babblePan } = this
    if (!ctx || !babbleGain || !babblePan) return
    babbleGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.35, ctx.currentTime, 0.2)
    babblePan.pan.setTargetAtTime(pan, ctx.currentTime, 0.2)
  }

  dispose() {
    this.disposed = true
    if (this.accentTimer !== null) clearTimeout(this.accentTimer)
    this.accentTimer = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}
