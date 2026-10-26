/** Caja en el plano del suelo (x, z). */
export interface Box {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface Vec2 {
  x: number
  z: number
}

/** Un actor visto desde arriba: un círculo en el suelo. `id` distingue a cada uno (el jugador usa -1). */
export interface Circle extends Vec2 {
  id: number
  r: number
}

export const boxAt = (cx: number, cz: number, width: number, depth: number): Box => ({
  minX: cx - width / 2,
  maxX: cx + width / 2,
  minZ: cz - depth / 2,
  maxZ: cz + depth / 2,
})

/** Empuja un círculo fuera de las cajas con las que se solapa, de modo que se deslice por las paredes. */
export function resolveCircle(position: Vec2, radius: number, boxes: readonly Box[], out: Vec2 = { x: 0, z: 0 }): Vec2 {
  let { x, z } = position
  // dos pasadas bastan para esquinas donde dos cajas empujan en direcciones distintas
  for (let pass = 0; pass < 2; pass++) {
    for (const box of boxes) {
      const nearestX = Math.min(Math.max(x, box.minX), box.maxX)
      const nearestZ = Math.min(Math.max(z, box.minZ), box.maxZ)
      const dx = x - nearestX
      const dz = z - nearestZ
      const distanceSquared = dx * dx + dz * dz
      if (distanceSquared >= radius * radius) continue
      if (distanceSquared > 1e-9) {
        const distance = Math.sqrt(distanceSquared)
        const push = radius - distance
        x += (dx / distance) * push
        z += (dz / distance) * push
      } else {
        // el centro está dentro de la caja: sale por el lado más cercano
        const left = x - box.minX
        const right = box.maxX - x
        const back = z - box.minZ
        const front = box.maxZ - z
        const least = Math.min(left, right, back, front)
        if (least === left) x = box.minX - radius
        else if (least === right) x = box.maxX + radius
        else if (least === back) z = box.minZ - radius
        else z = box.maxZ + radius
      }
    }
  }
  out.x = x
  out.z = z
  return out
}

/** Aparta un círculo de los otros actores con los que se solapa (ignora al que tiene `selfId`, que es él mismo). */
export function resolveCircles(position: Vec2, radius: number, others: readonly Circle[], selfId: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  let { x, z } = position
  for (const other of others) {
    if (other.id === selfId) continue
    const dx = x - other.x
    const dz = z - other.z
    const min = radius + other.r
    const distanceSquared = dx * dx + dz * dz
    if (distanceSquared >= min * min) continue
    if (distanceSquared > 1e-9) {
      const distance = Math.sqrt(distanceSquared)
      x += (dx / distance) * (min - distance)
      z += (dz / distance) * (min - distance)
    } else {
      // exactamente encima: se aparta hacia un lado cualquiera pero siempre el mismo (determinista)
      x += min
    }
  }
  out.x = x
  out.z = z
  return out
}

/** Fracción (0-1) del segmento a→b en la que entra en la caja, o null si no la toca. */
export function segmentEntry(ax: number, az: number, bx: number, bz: number, box: Box): number | null {
  // la cámara lo llama con cada pared en cada fotograma: sin crear arrays (eje x y luego eje z)
  const x = slab(ax, bx - ax, box.minX, box.maxX, 0, 1)
  if (x === null) return null
  const z = slab(az, bz - az, box.minZ, box.maxZ, x.tMin, x.tMax)
  return z === null ? null : z.tMin
}

const span = { tMin: 0, tMax: 1 }

/** Recorta [tMin, tMax] a la franja low-high de un eje (null si el segmento no la cruza). */
function slab(origin: number, direction: number, low: number, high: number, tMin: number, tMax: number): typeof span | null {
  if (Math.abs(direction) < 1e-9) {
    if (origin < low || origin > high) return null
  } else {
    let t1 = (low - origin) / direction
    let t2 = (high - origin) / direction
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }
  span.tMin = tMin
  span.tMax = tMax
  return span
}
