/**
 * Horarios del barrio, sin Three.js: cuándo abre cada tipo de local y cuándo está en la calle cada vecino. Las horas
 * van de 0 a 24 (con decimales); un tramo que pasa de medianoche se escribe con el final mayor que 24.
 */
import { FURNITURE, planBuilding } from './buildingPlan'
import type { Vec2 } from './collision'
import { makeRng, type Building, type ShopKind, type Spot } from './layout'

/** Un tramo del día: de `from` a `to` (h); `to` puede pasar de 24 (acaba al día siguiente). */
export interface HourSpan {
  from: number
  to: number
}

/** Horario de apertura de cada tipo de local. */
export const SHOP_HOURS: Record<ShopKind, HourSpan> = {
  panaderia: { from: 7, to: 20.5 },
  tienda: { from: 9, to: 21.5 },
  farmacia: { from: 9, to: 22 },
  peluqueria: { from: 10, to: 20 },
  cafe: { from: 8, to: 23.5 },
}

/** ¿Está `hour` dentro del tramo? */
export function inSpan(span: HourSpan, hour: number): boolean {
  const h = ((hour % 24) + 24) % 24
  return (h >= span.from && h < span.to) || (span.to > 24 && h < span.to - 24)
}

export const isShopOpen = (kind: ShopKind, hour: number) => inSpan(SHOP_HOURS[kind], hour)

/** La hora del día (0-24, con decimales) de una fecha. */
export const hourOf = (date: Date) => date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600

/** Cómo es el día de un vecino: de mañana, de tarde y noche, trasnochador... (para las pruebas y el diagnóstico). */
export type Routine = 'diurno' | 'madrugador' | 'tarde' | 'trasnochador' | 'deportista'

/**
 * Cuándo está en la calle un vecino. La mayoría, de día; unos pocos salen temprano, por la tarde o de noche, así que de
 * madrugada apenas queda gente y a media tarde está casi todo el mundo. Quien sale a correr lo hace a primera hora o al
 * caer la tarde. Los de una pareja comparten semilla, así que salen y se recogen a la vez.
 */
export function routineFor(seed: number, runner = false): { routine: Routine; span: HourSpan } {
  const rng = makeRng(seed)
  const jitter = () => (rng() - 0.5) * 1.5
  if (runner) return rng() < 0.5 ? { routine: 'deportista', span: { from: 6.5 + jitter() / 2, to: 10 + jitter() } } : { routine: 'deportista', span: { from: 17.5 + jitter(), to: 21.5 + jitter() } }
  const roll = rng()
  if (roll < 0.62) return { routine: 'diurno', span: { from: 8.5 + jitter(), to: 21.5 + jitter() } }
  if (roll < 0.77) return { routine: 'madrugador', span: { from: 6.5 + jitter() / 2, to: 15 + jitter() } }
  if (roll < 0.93) return { routine: 'tarde', span: { from: 15.5 + jitter(), to: 23.5 + jitter() } }
  return { routine: 'trasnochador', span: { from: 20 + jitter(), to: 26.5 + jitter() } }
}

/* ---------- puertas y puestos de trabajo ---------- */

/** Una puerta de la calle vista desde fuera: el centro del hueco y hacia dónde mira la calle (unitario). */
export interface StreetDoorSpot {
  x: number
  z: number
  nx: number
  nz: number
}

/** La hoja de la puerta del local está a esto del centro de su fachada (ver fachada_local en crear_interiores.py). */
const SHOP_DOOR_OFFSET = 1.1

/** La puerta del portal o la del local de un edificio. */
export function streetDoor(building: Building, which: 'portal' | 'local'): StreetDoorSpot {
  const spot = which === 'portal' ? building.portal : building.shop.door
  const nx = Math.sin(spot.yaw)
  const nz = Math.cos(spot.yaw)
  if (which === 'portal' || building.shop.kind === 'cafe') return { x: spot.x, z: spot.z, nx, nz }
  return { x: spot.x + nz * SHOP_DOOR_OFFSET, z: spot.z - nx * SHOP_DOOR_OFFSET, nx, nz }
}

/** Dónde atiende quien trabaja en un local (y por dónde llega desde la puerta), o null si el local no tiene sitio. */
export function staffPost(building: Building): { spot: Spot; path: Vec2[] } | null {
  const kind = building.shop.kind
  if (kind === 'cafe') return null
  const model = kind === 'panaderia' ? 'vitrina_panaderia' : kind === 'peluqueria' ? 'sillon_peluqueria' : 'mostrador'
  // el más cercano a la puerta: se le ve desde el escaparate
  const door = building.shop.door
  const near = (i: { x: number; z: number }) => Math.hypot(i.x - door.x, i.z - door.z)
  const item = planBuilding(building)
    .items.filter((i) => i.model === model && i.level === 0)
    .sort((a, b) => near(a) - near(b))[0]
  if (!item) return null
  const { w, d } = FURNITURE[model]
  // el frente del mueble y su derecha, en el mundo
  const fx = Math.sin(item.yaw)
  const fz = Math.cos(item.yaw)
  const rx = Math.cos(item.yaw)
  const rz = -Math.sin(item.yaw)
  const at = (front: number, right: number): Vec2 => ({ x: item.x + fx * front + rx * right, z: item.z + fz * front + rz * right })
  if (kind === 'peluqueria') {
    // de pie junto al sillón, mirando a quien se sienta
    const spot = at(d / 2 + 0.35, w / 2 + 0.25)
    return { spot: { ...spot, yaw: item.yaw + Math.PI }, path: [spot] }
  }
  // detrás del mostrador o la vitrina, mirando a la tienda; se llega rodeándolo por un lado
  const side = w / 2 + 0.45
  const spot = at(-(d / 2 + 0.45), 0)
  return { spot: { ...spot, yaw: item.yaw }, path: [at(d / 2 + 0.6, side), at(-(d / 2 + 0.45), side), spot] }
}
