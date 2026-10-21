import { Edges, IDLE_FRAME, PAD_NAMES, mergeMove, padKind, pickPad, readPad, type PadKind, type PadFrame, type PadLike } from './input'
import type { PlayerInput } from './player'

export type Controls = 'clasico' | 'flechas'
export type InputDevice = 'teclado' | 'mando'

export interface GamepadInfo {
  kind: PadKind
  name: string
  id: string
  /** ¿usa el mapeo estándar? Si no, los botones pueden no corresponder */
  standard: boolean
}

const MOVE_KEYS: Record<Controls, Record<string, [number, number]>> = {
  // [derecha, adelante]
  clasico: { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] },
  flechas: { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] },
}
const ORBIT_KEYS: Record<Controls, Record<string, [number, number]>> = {
  // [giro, inclinación]
  clasico: { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] },
  flechas: { KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, 1], KeyS: [0, -1] },
}
const INTERACT_KEY: Record<Controls, string> = { clasico: 'KeyE', flechas: 'Enter' }

/** ¿Necesita esta tecla el control que tiene el foco (activar un botón, mover un selector)? Entonces el juego la deja pasar. */
export function controlOwnsKey(target: EventTarget | null, code: string): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'BUTTON' || tag === 'A') return code === 'Enter'
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return code === 'Enter' || code.startsWith('Arrow')
  return false
}

/** Velocidades de giro de la cámara con teclado y con la palanca derecha (rad/s a tope). */
const KEY_YAW = 1.9
const KEY_PITCH = 1.0
const STICK_YAW = 2.8
const STICK_PITCH = 1.6
const STICK_ZOOM = 3

export interface InputTargets {
  orbit(deltaYaw: number, deltaPitch: number): void
  zoom(delta: number): void
}

export interface InputActions {
  move: PlayerInput
  /** acciones puntuales: true solo en el fotograma en que se pulsan */
  interact: boolean
  pause: boolean
  back: boolean
}

type GamepadSource = () => ArrayLike<PadLike | null> | null | undefined

const defaultSource: GamepadSource = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? (navigator.getGamepads() as unknown as ArrayLike<PadLike | null>) : null)

/** Teclado, ratón y mando juntos: se puede pasar de uno a otro sin reiniciar. */
export class InputController {
  device: InputDevice = 'teclado'
  gamepad: GamepadInfo | null = null

  private readonly pressed = new Set<string>()
  private shift = false
  private interactQueued = false
  private dragging = false
  private lastX = 0
  private lastY = 0
  private readonly edges = new Edges()
  private lastFrame: PadFrame = IDLE_FRAME
  private readonly cleanups: (() => void)[] = []
  private readonly canvas: HTMLCanvasElement
  private readonly controls: Controls
  private readonly targets: InputTargets
  private readonly onChange: () => void
  private readonly source: GamepadSource
  private isPaused: () => boolean

  constructor(canvas: HTMLCanvasElement, controls: Controls, targets: InputTargets, onChange: () => void, isPaused: () => boolean, source: GamepadSource = defaultSource) {
    this.canvas = canvas
    this.controls = controls
    this.targets = targets
    this.onChange = onChange
    this.isPaused = isPaused
    this.source = source
    this.bind()
    this.refreshGamepad()
  }

  private setDevice(device: InputDevice) {
    if (this.device === device) return
    this.device = device
    this.onChange()
  }

  private refreshGamepad() {
    const pad = pickPad(this.source())
    const info: GamepadInfo | null = pad ? { kind: padKind(pad.id), name: PAD_NAMES[padKind(pad.id)], id: pad.id, standard: pad.mapping === 'standard' } : null
    if (info?.id === this.gamepad?.id && Boolean(info) === Boolean(this.gamepad)) return
    this.gamepad = info
    if (!info) this.edges.reset()
    this.onChange()
  }

  private bind() {
    const { controls, canvas } = this
    const isGameKey = (code: string) => code in MOVE_KEYS[controls] || code in ORBIT_KEYS[controls] || code === 'ShiftLeft' || code === 'ShiftRight' || code === INTERACT_KEY[controls]
    const on = <K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void) => {
      window.addEventListener(type, handler)
      this.cleanups.push(() => window.removeEventListener(type, handler))
    }
    on('keydown', (event) => {
      if (this.isPaused() || event.ctrlKey || event.metaKey || event.altKey || !isGameKey(event.code)) return
      if (controlOwnsKey(event.target, event.code)) return
      event.preventDefault()
      this.setDevice('teclado')
      if (event.code === INTERACT_KEY[controls]) {
        if (!event.repeat) this.interactQueued = true
        return
      }
      this.pressed.add(event.code)
      this.shift = event.shiftKey
    })
    on('keyup', (event) => {
      this.pressed.delete(event.code)
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.shift = false
    })
    on('blur', () => {
      this.pressed.clear()
      this.shift = false
      this.dragging = false
    })
    on('gamepadconnected', () => this.refreshGamepad())
    on('gamepaddisconnected', () => {
      this.refreshGamepad()
      if (!this.gamepad && this.device === 'mando') this.setDevice('teclado')
    })

    const down = (event: PointerEvent) => {
      this.dragging = true
      this.lastX = event.clientX
      this.lastY = event.clientY
      this.setDevice('teclado')
      canvas.setPointerCapture?.(event.pointerId)
      canvas.focus({ preventScroll: true })
    }
    const move = (event: PointerEvent) => {
      if (!this.dragging || this.isPaused()) return
      this.targets.orbit(-(event.clientX - this.lastX) * 0.0055, (event.clientY - this.lastY) * 0.004)
      this.lastX = event.clientX
      this.lastY = event.clientY
    }
    const up = () => {
      this.dragging = false
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      this.targets.zoom(Math.sign(event.deltaY) * 0.5)
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
    })
  }

  /** Suelta lo que estuviera pulsado (al pausar, para que el personaje no siga andando al volver). */
  releaseAll() {
    this.pressed.clear()
    this.shift = false
    this.interactQueued = false
    this.dragging = false
  }

  /** Lee el estado de teclado y mando una vez por fotograma. Con el juego en pausa solo atiende al botón de pausa. */
  poll(dt: number): InputActions {
    this.refreshGamepad()
    const frame = readPad(pickPad(this.source()))
    this.lastFrame = frame
    if (frame.active) this.setDevice('mando')
    const pause = this.edges.press('pausa', frame.pause)
    const back = this.edges.press('atras', frame.back)
    const padInteract = this.edges.press('interactuar', frame.interact)
    if (this.isPaused()) return { move: { moveX: 0, moveZ: 0, run: false }, interact: false, pause, back }

    // cámara
    const orbit = ORBIT_KEYS[this.controls]
    for (const code of this.pressed) {
      const key = orbit[code]
      if (key) this.targets.orbit(key[0] * KEY_YAW * dt, key[1] * KEY_PITCH * dt)
    }
    // el eje Y de la palanca positivo es hacia abajo, igual que arrastrar el ratón hacia abajo
    if (frame.lookX !== 0 || frame.lookY !== 0) this.targets.orbit(-frame.lookX * STICK_YAW * dt, frame.lookY * STICK_PITCH * dt)
    if (frame.zoom !== 0) this.targets.zoom(frame.zoom * STICK_ZOOM * dt)

    // movimiento
    let keyX = 0
    let keyZ = 0
    for (const code of this.pressed) {
      const key = MOVE_KEYS[this.controls][code]
      if (key) {
        keyX += key[0]
        keyZ += key[1]
      }
    }
    const keyLength = Math.hypot(keyX, keyZ)
    const keyboard = keyLength > 1 ? { x: keyX / keyLength, z: keyZ / keyLength } : { x: keyX, z: keyZ }
    const merged = mergeMove(keyboard, { x: frame.moveX, z: frame.moveZ })
    const interact = this.interactQueued || padInteract
    this.interactQueued = false
    return { move: { moveX: merged.x, moveZ: merged.z, run: this.shift || frame.run }, interact, pause, back }
  }

  get padFrame(): PadFrame {
    return this.lastFrame
  }

  dispose() {
    this.cleanups.forEach((cleanup) => cleanup())
    this.cleanups.length = 0
  }
}
