import * as THREE from 'three'
import type { Quality } from './world'

/**
 * Alumbrado nocturno: pocas luces reales (caras de calcular) en las farolas más cercanas al protagonista y, en todas,
 * un charco de luz pintado en el suelo (casi gratis), que es lo que deja ver las calles iluminadas a lo lejos.
 */

/** Luces reales por calidad. Cada una se calcula en cada píxel iluminado: 24 bajaban los FPS a la mitad en una gráfica integrada. */
export const REAL_LAMPS: Record<Quality, number> = { baja: 0, media: 4, alta: 8 }

/** Las luces reales: intensidad, alcance (m) y caída física. */
export const LAMP_LIGHT = { color: 0xffc779, intensity: 18, distance: 28, decay: 2 } as const

/** Altura de la luminaria (m). */
export const LAMP_HEIGHT = 4.1

/** Segundos que tarda una luz real en apagarse o encenderse al cambiar de farola, para que no se vea un salto. */
export const LAMP_FADE = 0.35

interface Point {
  x: number
  z: number
}

/** Una farola: el poste y hacia dónde apunta su brazo (el mismo giro con el que se coloca el modelo). */
export interface Lamp extends Point {
  yaw: number
}

/** Largo del brazo de la farola: de la base del poste a la luminaria (m). */
export const LAMP_ARM = 0.82

/** Dónde cuelga la luminaria: a LAMP_ARM del poste, hacia el lado al que apunta el brazo. */
export function lampHead(lamp: Lamp): Point {
  return { x: lamp.x + Math.cos(lamp.yaw) * LAMP_ARM, z: lamp.z - Math.sin(lamp.yaw) * LAMP_ARM }
}

/** Índices de las `count` farolas más cercanas a (x, z), de la más cercana a la más lejana; los empates, por orden. */
export function nearestLamps(lamps: readonly Point[], x: number, z: number, count: number): number[] {
  if (count <= 0) return []
  return lamps
    .map((lamp, index) => ({ index, distance: Math.hypot(lamp.x - x, lamp.z - z) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, count)
    .map((item) => item.index)
}

export interface LampSlot {
  /** farola que ilumina (índice), o null si está libre */
  lamp: number | null
  /** 0 apagada, 1 a plena intensidad */
  level: number
}

/**
 * Reparte unas pocas luces reales entre las farolas que se piden. Una luz que sobra se apaga poco a poco y, ya apagada,
 * pasa a una farola que no tenga luz y se enciende poco a poco: nunca salta de golpe de un sitio a otro.
 */
export class LampAssigner {
  readonly slots: LampSlot[]

  constructor(count: number) {
    this.slots = Array.from({ length: count }, () => ({ lamp: null, level: 0 }))
  }

  update(dt: number, wanted: readonly number[], instant = false) {
    const step = instant ? 1 : dt / LAMP_FADE
    const wantedSet = new Set(wanted)
    const lit = new Set(this.slots.map((slot) => slot.lamp).filter((lamp): lamp is number => lamp !== null && wantedSet.has(lamp)))
    const missing = wanted.filter((lamp) => !lit.has(lamp))
    for (const slot of this.slots) {
      const keep = slot.lamp !== null && wantedSet.has(slot.lamp)
      if (!keep && slot.level > 0) {
        slot.level = Math.max(0, slot.level - step)
        if (slot.level > 0) continue
      }
      if (!keep) slot.lamp = missing.shift() ?? null
      if (slot.lamp !== null) slot.level = Math.min(1, slot.level + (keep ? step : instant ? 1 : 0))
    }
  }
}

/** Radio del charco de luz en el suelo (m). */
export const POOL_RADIUS = 6.5
/** Altura del charco: justo por encima de la acera, para que no parpadee con el suelo. */
export const POOL_HEIGHT = 0.09
/** Cuánto ilumina el charco (opacidad máxima de la mezcla aditiva). */
export const POOL_STRENGTH = 0.55

/** Caída de la luz del charco con la distancia al centro (0 = centro, 1 = borde): suave y nula en el borde. */
export function poolFalloff(r: number): number {
  if (r >= 1) return 0
  const edge = 1 - r * r
  return edge * edge * Math.exp(-1.6 * r)
}

/** Textura del charco: blanca, con la caída en la transparencia; el color cálido lo pone el material. */
export function poolTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(poolFalloff(r) * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/** Un charco de luz bajo cada farola, todos en una sola llamada de dibujo. Visible solo de noche. */
export function buildLightPools(lamps: readonly Lamp[]): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(POOL_RADIUS * 2, POOL_RADIUS * 2).rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    map: poolTexture(),
    color: LAMP_LIGHT.color,
    transparent: true,
    opacity: POOL_STRENGTH,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  })
  const pools = new THREE.InstancedMesh(geometry, material, lamps.length)
  const matrix = new THREE.Matrix4()
  const scale = new THREE.Vector3()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  lamps.forEach((lamp, index) => {
    const head = lampHead(lamp)
    // un poco de variedad en el tamaño para que no se note que son iguales
    const size = 0.9 + ((index * 37) % 11) / 50
    matrix.compose(position.set(head.x, POOL_HEIGHT, head.z), rotation, scale.set(size, 1, size))
    pools.setMatrixAt(index, matrix)
  })
  pools.instanceMatrix.needsUpdate = true
  pools.castShadow = false
  pools.receiveShadow = false
  pools.visible = false
  pools.name = 'charcos-de-luz'
  return pools
}

/** Libera una malla de luz pintada (charcos o resplandores): geometría, material y textura. */
export function disposeLightPools(pools: THREE.InstancedMesh) {
  pools.removeFromParent()
  pools.geometry.dispose()
  const material = pools.material as THREE.MeshBasicMaterial
  material.map?.dispose()
  material.dispose()
  pools.dispose()
}

interface FacadeBox {
  box: { minX: number; maxX: number; minZ: number; maxZ: number }
  height: number
}

/** Hasta qué distancia (m) de la luminaria una fachada recibe su resplandor: la acera mide 4 m y la luminaria cuelga sobre la calzada. */
export const GLOW_REACH = 6
/** Tamaño del resplandor en la fachada (m): ancho y alto, centrado a la altura de la luminaria. */
export const GLOW_WIDTH = 10
export const GLOW_HEIGHT = 8
/** Separación de la pared, para que no parpadee con ella. */
export const GLOW_GAP = 0.05
export const GLOW_STRENGTH = 0.6
/** Un poco más cálido que la luz de la farola: en la pared se mezcla con el azul de la noche y si no queda pálido. */
export const GLOW_COLOR = 0xffb35c

export interface FacadeGlow {
  /** farola que lo produce */
  lamp: number
  x: number
  z: number
  /** hacia dónde mira la fachada (normal hacia la calle) */
  normal: { x: number; z: number }
}

/**
 * Dónde pinta cada farola su resplandor: en la fachada del edificio que tiene justo detrás, si lo hay. Junto al parque
 * o en una esquina sin pared delante no hay resplandor (quedaría flotando en el aire).
 */
export function facadeGlows(lamps: readonly Lamp[], buildings: readonly FacadeBox[]): FacadeGlow[] {
  const glows: FacadeGlow[] = []
  lamps.forEach((lamp, index) => {
    const head = lampHead(lamp)
    let best: FacadeGlow | null = null
    let bestDistance = GLOW_REACH
    for (const { box, height } of buildings) {
      if (height < GLOW_HEIGHT) continue
      const insideX = head.x >= box.minX && head.x <= box.maxX
      const insideZ = head.z >= box.minZ && head.z <= box.maxZ
      // la luminaria tiene que estar delante de una cara, no en diagonal con una esquina
      if (insideX === insideZ) continue
      const candidate: [number, FacadeGlow] = insideX
        ? head.z < box.minZ
          ? [box.minZ - head.z, { lamp: index, x: head.x, z: box.minZ - GLOW_GAP, normal: { x: 0, z: -1 } }]
          : [head.z - box.maxZ, { lamp: index, x: head.x, z: box.maxZ + GLOW_GAP, normal: { x: 0, z: 1 } }]
        : head.x < box.minX
          ? [box.minX - head.x, { lamp: index, x: box.minX - GLOW_GAP, z: head.z, normal: { x: -1, z: 0 } }]
          : [head.x - box.maxX, { lamp: index, x: box.maxX + GLOW_GAP, z: head.z, normal: { x: 1, z: 0 } }]
      if (candidate[0] < bestDistance) {
        bestDistance = candidate[0]
        best = candidate[1]
      }
    }
    if (best) glows.push(best)
  })
  return glows
}

/** Un resplandor cálido en la fachada de detrás de cada farola, todos en una sola llamada de dibujo. Visible solo de noche. */
export function buildFacadeGlows(glows: readonly FacadeGlow[]): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(GLOW_WIDTH, GLOW_HEIGHT)
  const material = new THREE.MeshBasicMaterial({
    map: poolTexture(),
    color: GLOW_COLOR,
    transparent: true,
    opacity: GLOW_STRENGTH,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
    // pegado a la pared: se adelanta un poco en profundidad para que gane siempre a la fachada
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, glows.length)
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  glows.forEach((glow, index) => {
    // el plano mira hacia +z: se gira para que mire a la calle
    rotation.setFromAxisAngle(up, Math.atan2(glow.normal.x, glow.normal.z))
    matrix.compose(position.set(glow.x, LAMP_HEIGHT, glow.z), rotation, scale)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.visible = false
  mesh.name = 'resplandor-de-fachadas'
  return mesh
}
