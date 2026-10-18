/**
 * Entrada con mando (Gamepad API, mapeo "standard" del W3C): sin DOM, para poder probarla con datos inventados.
 *
 * Botones: 0 A/Cruz · 1 B/Círculo · 4-5 LB/RB (L1/R1) · 6-7 LT/RT (L2/R2) · 9 Start/Options · 10 L3 · 12-15 cruceta.
 * Ejes: 0-1 palanca izquierda (X, Y), 2-3 palanca derecha (X, Y); Y positivo es hacia abajo.
 */

export interface PadButton {
  pressed: boolean
  value: number
}

export interface PadLike {
  id: string
  mapping: string
  connected: boolean
  axes: readonly number[]
  buttons: readonly PadButton[]
}

export type PadKind = 'playstation' | 'xbox' | 'otro'

export interface PadFrame {
  /** movimiento: -1..1, X a la derecha y Z hacia delante (como el teclado) */
  moveX: number
  moveZ: number
  /** giro de la cámara con la palanca derecha: X a la derecha, Y hacia abajo */
  lookX: number
  lookY: number
  run: boolean
  /** -1 acerca la cámara, 1 la aleja (LB / RB) */
  zoom: number
  /** botones de acción (el llamador detecta el flanco con `Edges`) */
  interact: boolean
  back: boolean
  pause: boolean
  /** ¿se está tocando algo? (para saber con qué dispositivo se juega) */
  active: boolean
}

export const IDLE_FRAME: PadFrame = Object.freeze({
  moveX: 0, moveZ: 0, lookX: 0, lookY: 0, run: false, zoom: 0, interact: false, back: false, pause: false, active: false,
})

export const STICK_DEADZONE = 0.2
export const LOOK_DEADZONE = 0.15
export const TRIGGER_THRESHOLD = 0.35

/** Zona muerta radial: ignora lo que no llega a `inner` y reescala el resto para que el recorrido útil vaya de 0 a 1. */
export function deadzone(x: number, y: number, inner: number): [number, number] {
  const length = Math.hypot(x, y)
  if (length <= inner) return [0, 0]
  const scaled = Math.min(1, (length - inner) / (1 - inner))
  return [(x / length) * scaled, (y / length) * scaled]
}

/** Qué mando es, por el nombre que da el navegador (para mostrar los nombres de botones correctos). */
export function padKind(id: string): PadKind {
  // Xbox primero: "Xbox Wireless Controller" también contiene "wireless controller"
  if (/xbox|045e|xinput|microsoft/i.test(id)) return 'xbox'
  if (/054c|dualshock|dualsense|playstation|sony/i.test(id)) return 'playstation'
  return 'otro'
}

export const PAD_NAMES: Record<PadKind, string> = { playstation: 'PlayStation', xbox: 'Xbox', otro: 'Mando' }

/** Nombre de cada acción en el mando que se tenga. */
export function padLabels(kind: PadKind) {
  const sony = kind === 'playstation'
  return {
    move: 'palanca izquierda',
    camera: 'palanca derecha',
    run: sony ? 'R2' : 'RT',
    interact: sony ? 'Cruz (✕)' : 'A',
    pause: sony ? 'Options' : 'Menú',
  }
}

const down = (pad: PadLike, index: number) => Boolean(pad.buttons[index]?.pressed)
const analog = (pad: PadLike, index: number) => pad.buttons[index]?.value ?? (pad.buttons[index]?.pressed ? 1 : 0)

export function readPad(pad: PadLike | null | undefined): PadFrame {
  if (!pad || !pad.connected) return IDLE_FRAME
  const [stickX, stickY] = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE)
  const [lookX, lookY] = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, LOOK_DEADZONE)
  // la cruceta mueve a velocidad completa; si se usan las dos, gana la que más empuja
  const padX = (down(pad, 15) ? 1 : 0) - (down(pad, 14) ? 1 : 0)
  const padZ = (down(pad, 12) ? 1 : 0) - (down(pad, 13) ? 1 : 0)
  const useDpad = Math.hypot(padX, padZ) > Math.hypot(stickX, stickY)
  const moveX = useDpad ? padX : stickX
  const moveZ = useDpad ? padZ : 0 - stickY // 0 - y evita el -0
  const frame: PadFrame = {
    moveX,
    moveZ,
    lookX,
    lookY,
    run: analog(pad, 7) > TRIGGER_THRESHOLD || down(pad, 10),
    zoom: (down(pad, 5) ? 1 : 0) - (down(pad, 4) ? 1 : 0),
    interact: down(pad, 0),
    back: down(pad, 1),
    pause: down(pad, 9),
    active: false,
  }
  frame.active =
    moveX !== 0 || moveZ !== 0 || lookX !== 0 || lookY !== 0 || frame.run || frame.zoom !== 0 || frame.interact || frame.back || frame.pause
  return frame
}

/** El primer mando conectado de la lista que da el navegador (que puede traer huecos con null). */
export function pickPad(pads: ArrayLike<PadLike | null> | null | undefined): PadLike | null {
  if (!pads) return null
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i]
    if (pad?.connected) return pad
  }
  return null
}

/** Detecta el momento en que se pulsa un botón (flanco de subida), por nombre. */
export class Edges {
  private readonly held = new Map<string, boolean>()

  /** Devuelve true solo en la primera lectura con el botón pulsado. */
  press(name: string, isDown: boolean): boolean {
    const was = this.held.get(name) ?? false
    this.held.set(name, isDown)
    return isDown && !was
  }

  reset() {
    this.held.clear()
  }
}

/** Suma el movimiento de teclado y mando, sin pasar de 1 en total. */
export function mergeMove(keyboard: { x: number; z: number }, pad: { x: number; z: number }): { x: number; z: number } {
  const x = keyboard.x + pad.x
  const z = keyboard.z + pad.z
  const length = Math.hypot(x, z)
  return length > 1 ? { x: x / length, z: z / length } : { x, z }
}
