import type { Vec2 } from './collision'

export interface CelestialState {
  hour: number
  sunAltitude: number
  sunAzimuth: number
  sunDirection: { x: number; y: number; z: number }
  moonDirection: { x: number; y: number; z: number }
  daylight: number
  night: boolean
}

export type MoonPhase = 'nueva' | 'creciente' | 'llena' | 'menguante'

const LATITUDE = (40.4168 * Math.PI) / 180
const LONGITUDE = -3.7038
const DEG = Math.PI / 180
const LUNAR_MONTH_MS = 29.530588853 * 86_400_000
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

export function lunarPhase(date: Date): { age: number; illumination: number; phase: MoonPhase } {
  const age = ((date.getTime() - KNOWN_NEW_MOON) % LUNAR_MONTH_MS + LUNAR_MONTH_MS) % LUNAR_MONTH_MS / LUNAR_MONTH_MS
  const quarter = Math.round(age * 4) % 4
  const phases: MoonPhase[] = ['nueva', 'creciente', 'llena', 'menguante']
  return { age, illumination: (1 - Math.cos(age * Math.PI * 2)) / 2, phase: phases[quarter] }
}

export function advanceGameClock(date: Date, realSeconds: number): Date {
  if (!Number.isFinite(realSeconds) || realSeconds < 0) throw new RangeError(`Duración de reloj no válida: ${realSeconds}`)
  return new Date(date.getTime() + realSeconds * 60_000)
}

export function formatGameClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (low: number, high: number, value: number) => {
  const t = clamp01((value - low) / (high - low))
  return t * t * (3 - 2 * t)
}

/** Approximate local solar position for the project's Madrid setting. */
export function celestialState(date: Date): CelestialState {
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000)
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
  const gamma = (2 * Math.PI / 365) * (day - 1 + (minutes / 60 - 12) / 24)
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  const timeZoneHours = -date.getTimezoneOffset() / 60
  const solarMinutes = minutes + equationOfTime + 4 * LONGITUDE - 60 * timeZoneHours
  const hourAngle = (solarMinutes / 4 - 180) * DEG
  const sinAltitude = Math.sin(LATITUDE) * Math.sin(declination) + Math.cos(LATITUDE) * Math.cos(declination) * Math.cos(hourAngle)
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude)))
  const azimuth =
    (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(LATITUDE) - Math.tan(declination) * Math.cos(LATITUDE)) + Math.PI + 2 * Math.PI) %
    (2 * Math.PI)
  const horizontal = Math.cos(altitude)
  const sunDirection = {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(altitude),
    z: Math.cos(azimuth) * horizontal,
  }
  const daylight = smooth(Math.sin(-6 * DEG), Math.sin(5 * DEG), sinAltitude)

  return {
    hour: date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600,
    sunAltitude: altitude,
    sunAzimuth: azimuth,
    sunDirection,
    moonDirection: { x: -sunDirection.x, y: -sunDirection.y, z: -sunDirection.z },
    daylight,
    night: altitude < -6 * DEG,
  }
}

export function skyColors(daylight: number, sunAltitude: number): { sky: number; ground: number } {
  const daySky = { r: 0xbc, g: 0xd2, b: 0xe4 }
  const twilightSky = { r: 0xe5, g: 0x9c, b: 0x79 }
  const nightSky = { r: 0x11, g: 0x1d, b: 0x36 }
  const twilight = smooth(-0.14, 0.03, sunAltitude) * (1 - smooth(0.03, 0.18, sunAltitude))
  const day = smooth(0.02, 0.22, daylight)
  const sky = blend(blend(nightSky, twilightSky, twilight), daySky, day)
  const ground = blend({ r: 0x25, g: 0x2b, b: 0x32 }, { r: 0x6f, g: 0x6a, b: 0x5c }, day)
  return { sky: (sky.r << 16) | (sky.g << 8) | sky.b, ground: (ground.r << 16) | (ground.g << 8) | ground.b }
}

function blend(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, amount: number) {
  const t = clamp01(amount)
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

export function celestialPosition(direction: CelestialState['sunDirection'], origin: Vec2, distance: number): { x: number; y: number; z: number } {
  return { x: origin.x + direction.x * distance, y: direction.y * distance + 1.45, z: origin.z + direction.z * distance }
}
