import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { BLOCK_PITCH, CURB_DISTANCE, RING_OUTER, RING_WALK, generateCity, groundAt } from './layout'
import {
  GLOW_GAP, GLOW_HEIGHT, GLOW_REACH, LAMP_FADE, LampAssigner, POOL_HEIGHT, REAL_LAMPS, buildFacadeGlows, buildLightPools, disposeLightPools, facadeGlows,
  LAMP_ARM, lampHead, nearestLamps, poolFalloff, poolTexture,
} from './streetLights'

const city = generateCity()

describe('nearestLamps', () => {
  const lamps = [{ x: 10, z: 0 }, { x: 1, z: 0 }, { x: -5, z: 0 }, { x: 0, z: 3 }]

  it('devuelve las más cercanas, de la más cercana a la más lejana', () => {
    expect(nearestLamps(lamps, 0, 0, 3)).toEqual([1, 3, 2])
  })

  it('sin luces no devuelve ninguna, y si se piden más de las que hay, todas', () => {
    expect(nearestLamps(lamps, 0, 0, 0)).toEqual([])
    expect(nearestLamps(lamps, 0, 0, 10)).toHaveLength(4)
  })

  it('con empates mantiene siempre el mismo orden (el de la lista)', () => {
    const tied = [{ x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }]
    expect(nearestLamps(tied, 0, 0, 3)).toEqual([0, 1, 2])
    expect(nearestLamps(tied, 0, 0, 3)).toEqual(nearestLamps(tied, 0, 0, 3))
  })

  it('en el barrio real elige farolas a menos distancia que las que deja fuera', () => {
    const chosen = nearestLamps(city.lamps, 0, RING_WALK, 8)
    const distance = (i: number) => Math.hypot(city.lamps[i].x, city.lamps[i].z - RING_WALK)
    const farthestChosen = Math.max(...chosen.map(distance))
    const others = city.lamps.map((_, i) => i).filter((i) => !chosen.includes(i))
    expect(Math.min(...others.map(distance))).toBeGreaterThanOrEqual(farthestChosen)
  })
})

describe('lampHead', () => {
  it('todas las luminarias cuelgan sobre la calzada, a un brazo del poste, que está en el bordillo', () => {
    for (const lamp of city.lamps) {
      const head = lampHead(lamp)
      expect(groundAt(lamp.x, lamp.z)).toBe('acera')
      expect(groundAt(head.x, head.z), `farola en (${lamp.x}, ${lamp.z})`).toBe('calzada')
      expect(Math.hypot(head.x - lamp.x, head.z - lamp.z)).toBeCloseTo(LAMP_ARM)
      // el brazo es perpendicular al bordillo: sale recto hacia la calle, alejándose de su manzana
      const block = { x: Math.round(lamp.x / BLOCK_PITCH) * BLOCK_PITCH, z: Math.round(lamp.z / BLOCK_PITCH) * BLOCK_PITCH }
      const reach = (p: { x: number; z: number }) => Math.max(Math.abs(p.x - block.x), Math.abs(p.z - block.z))
      expect(reach(lamp)).toBeCloseTo(CURB_DISTANCE)
      expect(reach(head)).toBeCloseTo(CURB_DISTANCE + LAMP_ARM)
    }
  })

  it('sigue el giro de cada farola', () => {
    const flat = lampHead({ x: 0, z: 0, yaw: 0 })
    expect(flat.x).toBeCloseTo(LAMP_ARM)
    expect(flat.z).toBeCloseTo(0)
    const head = lampHead({ x: 1, z: 2, yaw: Math.PI / 2 })
    expect(head.x).toBeCloseTo(1)
    expect(head.z).toBeCloseTo(2 - LAMP_ARM)
    expect(CURB_DISTANCE + LAMP_ARM).toBeGreaterThan(RING_OUTER)
  })
})

describe('luces reales por calidad', () => {
  it('0 en baja, 4 en media y 8 en alta', () => {
    expect(REAL_LAMPS).toEqual({ baja: 0, media: 4, alta: 8 })
  })
})

describe('LampAssigner', () => {
  it('al colocarse de golpe ilumina justo las farolas pedidas, sin repetir ninguna', () => {
    const assigner = new LampAssigner(3)
    assigner.update(0, [5, 7, 9], true)
    expect(assigner.slots.map((s) => s.lamp).sort()).toEqual([5, 7, 9])
    expect(assigner.slots.every((s) => s.level === 1)).toBe(true)
  })

  it('al cambiar de farola, la luz se apaga y se enciende poco a poco: nunca salta de golpe', () => {
    const assigner = new LampAssigner(2)
    assigner.update(0, [1, 2], true)
    const dt = 1 / 60
    let previous = assigner.slots.map((s) => ({ ...s }))
    let frames = 0
    // la farola 2 deja de estar entre las cercanas y entra la 3
    while (frames < 200) {
      assigner.update(dt, [1, 3])
      assigner.slots.forEach((slot, i) => {
        expect(Math.abs(slot.level - previous[i].level)).toBeLessThanOrEqual(dt / LAMP_FADE + 1e-9)
        // una luz solo cambia de farola cuando está apagada
        if (slot.lamp !== previous[i].lamp) expect(slot.level).toBe(0)
      })
      previous = assigner.slots.map((s) => ({ ...s }))
      frames++
      if (assigner.slots.every((s) => s.level === 1) && assigner.slots.some((s) => s.lamp === 3)) break
    }
    expect(assigner.slots.map((s) => s.lamp).sort()).toEqual([1, 3])
    // apagarse y encenderse lleva unas dos veces el fundido
    expect(frames * dt).toBeLessThan(LAMP_FADE * 2 + 0.1)
  })

  it('si una farola que se apagaba vuelve a estar cerca, su luz vuelve a subir sin moverse', () => {
    const assigner = new LampAssigner(1)
    assigner.update(0, [4], true)
    assigner.update(LAMP_FADE / 2, [6])
    expect(assigner.slots[0]).toMatchObject({ lamp: 4 })
    assigner.update(LAMP_FADE / 2, [4])
    expect(assigner.slots[0]).toMatchObject({ lamp: 4, level: 1 })
  })

  it('sin farolas pedidas (de día) todas quedan libres y apagadas', () => {
    const assigner = new LampAssigner(2)
    assigner.update(0, [1, 2], true)
    assigner.update(0, [], true)
    expect(assigner.slots).toEqual([{ lamp: null, level: 0 }, { lamp: null, level: 0 }])
  })
})

describe('charcos de luz', () => {
  it('la luz cae suavemente del centro al borde, donde vale 0', () => {
    expect(poolFalloff(0)).toBe(1)
    expect(poolFalloff(1)).toBe(0)
    expect(poolFalloff(1.5)).toBe(0)
    let previous = Infinity
    for (let r = 0; r <= 1; r += 0.05) {
      const value = poolFalloff(r)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
    // sin borde duro: cerca del borde ya casi no queda luz
    expect(poolFalloff(0.95)).toBeLessThan(0.01)
  })

  it('la textura es más opaca en el centro y transparente en las esquinas', () => {
    const texture = poolTexture(32)
    const data = texture.image.data as Uint8Array
    const alpha = (x: number, y: number) => data[(y * 32 + x) * 4 + 3]
    expect(alpha(16, 16)).toBeGreaterThan(200)
    expect(alpha(0, 0)).toBe(0)
    expect(alpha(16, 0)).toBeLessThan(5)
    texture.dispose()
  })

  it('hay un charco bajo la luminaria de cada farola, a ras de acera', () => {
    const pools = buildLightPools(city.lamps)
    expect(city.lamps.length).toBeGreaterThan(60)
    expect(pools.count).toBe(city.lamps.length)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    city.lamps.forEach((lamp, index) => {
      pools.getMatrixAt(index, matrix)
      position.setFromMatrixPosition(matrix)
      const head = lampHead(lamp)
      expect(position.x).toBeCloseTo(head.x)
      expect(position.z).toBeCloseTo(head.z)
      expect(position.y).toBeCloseTo(POOL_HEIGHT)
    })
    expect(POOL_HEIGHT).toBeGreaterThan(0.02)
    expect(POOL_HEIGHT).toBeLessThan(0.1)
    disposeLightPools(pools)
  })

  it('suman luz sin tapar nada, con niebla, sin sombras y ocultos hasta que anochece', () => {
    const pools = buildLightPools(city.lamps)
    const material = pools.material as THREE.MeshBasicMaterial
    expect(material.transparent).toBe(true)
    expect(material.blending).toBe(THREE.AdditiveBlending)
    expect(material.depthWrite).toBe(false)
    expect(material.depthTest).toBe(true)
    expect(material.fog).toBe(true)
    expect(pools.castShadow).toBe(false)
    expect(pools.receiveShadow).toBe(false)
    expect(pools.visible).toBe(false)
    disposeLightPools(pools)
  })

  it('cada resplandor está pegado a la fachada del edificio que la farola tiene detrás, mirando a la calle', () => {
    const glows = facadeGlows(city.lamps, city.buildings)
    // casi todas las farolas tienen un edificio detrás; las del parque, no
    expect(glows.length).toBeGreaterThan(city.lamps.length / 2)
    expect(glows.length).toBeLessThan(city.lamps.length)
    for (const glow of glows) {
      const head = lampHead(city.lamps[glow.lamp])
      // la normal apunta de la pared a la luminaria, y la luminaria está cerca
      const toLamp = { x: head.x - glow.x, z: head.z - glow.z }
      expect(toLamp.x * glow.normal.x + toLamp.z * glow.normal.z).toBeGreaterThan(0)
      expect(Math.hypot(toLamp.x, toLamp.z)).toBeLessThanOrEqual(GLOW_REACH + GLOW_GAP)
      // está sobre la cara de un edificio de al menos la altura del resplandor
      const wall = city.buildings.find(({ box, height }) => {
        if (height < GLOW_HEIGHT) return false
        if (glow.normal.z !== 0) {
          const face = glow.normal.z > 0 ? box.maxZ : box.minZ
          return Math.abs(glow.z - glow.normal.z * GLOW_GAP - face) < 1e-9 && glow.x >= box.minX && glow.x <= box.maxX
        }
        const face = glow.normal.x > 0 ? box.maxX : box.minX
        return Math.abs(glow.x - glow.normal.x * GLOW_GAP - face) < 1e-9 && glow.z >= box.minZ && glow.z <= box.maxZ
      })
      expect(wall, `farola ${glow.lamp}`).toBeDefined()
    }
  })

  it('junto al parque no hay resplandor: quedaría flotando sin pared', () => {
    const glows = facadeGlows(city.lamps, city.buildings)
    const { park } = city
    const parkLamps = city.lamps.map((lamp, i) => ({ lamp, i })).filter(({ lamp }) => lamp.x > park.minX - 4 && lamp.x < park.maxX + 4 && lamp.z > park.minZ - 4 && lamp.z < park.maxZ + 4)
    expect(parkLamps.length).toBeGreaterThan(0)
    for (const { i } of parkLamps) expect(glows.some((glow) => glow.lamp === i)).toBe(false)
  })

  it('los resplandores son una malla aditiva sin sombras, por delante de la pared y oculta de día', () => {
    const glows = facadeGlows(city.lamps, city.buildings)
    const mesh = buildFacadeGlows(glows)
    const material = mesh.material as THREE.MeshBasicMaterial
    expect(mesh.count).toBe(glows.length)
    expect(material.blending).toBe(THREE.AdditiveBlending)
    expect(material.depthWrite).toBe(false)
    expect(material.polygonOffset).toBe(true)
    expect(material.fog).toBe(true)
    expect(mesh.castShadow || mesh.receiveShadow).toBe(false)
    expect(mesh.visible).toBe(false)
    // el plano mira hacia la calle: su normal girada coincide con la de la fachada
    const matrix = new THREE.Matrix4()
    const normal = new THREE.Vector3()
    glows.forEach((glow, i) => {
      mesh.getMatrixAt(i, matrix)
      normal.set(0, 0, 1).transformDirection(matrix)
      expect(normal.x).toBeCloseTo(glow.normal.x)
      expect(normal.z).toBeCloseTo(glow.normal.z)
    })
    disposeLightPools(mesh)
  })

  it('al liberarlos se sueltan la geometría, el material y la textura', () => {
    const pools = buildLightPools(city.lamps)
    const material = pools.material as THREE.MeshBasicMaterial
    const spies = [vi.spyOn(pools.geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(material.map!, 'dispose')]
    const parent = new THREE.Group().add(pools)
    disposeLightPools(pools)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(parent.children).toHaveLength(0)
  })
})
