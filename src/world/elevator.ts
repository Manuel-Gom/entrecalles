/**
 * Cómo viaja la cabina del ascensor, sin Three.js: arranca y frena con aceleración constante y entre medias va a
 * velocidad de crucero (o, si el viaje es corto, acelera hasta la mitad y frena el resto).
 */

/** Velocidad máxima de la cabina (m/s) y lo que tarda en alcanzarla (s). */
export const ELEVATOR_MAX_SPEED = 2.5
export const ELEVATOR_RAMP_SECONDS = 0.6
const ACCELERATION = ELEVATOR_MAX_SPEED / ELEVATOR_RAMP_SECONDS

/** Lo que tarda en recorrer `distance` metros (s). */
export function travelDuration(distance: number): number {
  const d = Math.abs(distance)
  const ramp = (ACCELERATION * ELEVATOR_RAMP_SECONDS ** 2) / 2
  if (d >= 2 * ramp) return 2 * ELEVATOR_RAMP_SECONDS + (d - 2 * ramp) / ELEVATOR_MAX_SPEED
  return 2 * Math.sqrt(d / ACCELERATION)
}

/** Cuánto ha recorrido (m, de 0 a `distance`) a los `t` segundos de salir. */
export function travelOffset(distance: number, t: number): number {
  const d = Math.abs(distance)
  const total = travelDuration(d)
  if (t <= 0) return 0
  if (t >= total) return distance
  const ramp = Math.min(ELEVATOR_RAMP_SECONDS, total / 2)
  const top = ACCELERATION * ramp
  let s: number
  if (t < ramp) s = (ACCELERATION * t * t) / 2
  else if (t <= total - ramp) s = (ACCELERATION * ramp * ramp) / 2 + top * (t - ramp)
  else {
    const left = total - t
    s = d - (ACCELERATION * left * left) / 2
  }
  return Math.sign(distance) * Math.min(d, s)
}
