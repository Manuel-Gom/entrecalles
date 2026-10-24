import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FOUNTAIN_LEVELS, FOUNTAIN_RADII, dressFountain, skipWaterShadows } from './water'
import { compileStandard as compile, usedBeforeDeclared } from '../test/shader'

/** Una fuente de mentira: una malla por material, con los nombres que trae fuente.glb. */
function fakeFountain(names: string[]) {
  const root = new THREE.Group()
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  for (const name of names) {
    const material = new THREE.MeshStandardMaterial({ name })
    materials.set(name, material)
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    mesh.castShadow = true
    root.add(mesh)
  }
  return { root, materials }
}

describe('fuente: orden de las láminas de agua', () => {
  it('las tres láminas van de abajo arriba y cada taza es más pequeña que la anterior', () => {
    expect(FOUNTAIN_LEVELS.lower).toBeLessThan(FOUNTAIN_LEVELS.middle)
    expect(FOUNTAIN_LEVELS.middle).toBeLessThan(FOUNTAIN_LEVELS.top)
    expect(FOUNTAIN_RADII.lower).toBeGreaterThan(FOUNTAIN_RADII.middle)
    expect(FOUNTAIN_RADII.middle).toBeGreaterThan(FOUNTAIN_RADII.top)
  })
})

describe('dressFountain', () => {
  it('sin material de agua no hay nada que animar', () => {
    const { root } = fakeFountain(['PiedraFuente', 'BronceFuente'])
    expect(dressFountain(root)).toBeNull()
  })

  it('el agua es transparente, no escribe en el z-buffer y tiene su propio shader', () => {
    const { root, materials } = fakeFountain(['AguaFuente', 'PiedraFuente'])
    expect(dressFountain(root)).not.toBeNull()
    const water = materials.get('AguaFuente')!
    expect(water.transparent).toBe(true)
    expect(water.depthWrite).toBe(false)
    expect(water.customProgramCacheKey()).toContain('water')
    const shader = compile(water)
    expect(shader.fragmentShader).toContain('fxFresnel') // reflejo del cielo según el ángulo
    expect(shader.fragmentShader).toContain('fxFoam') // espuma
    expect(shader.fragmentShader).toContain('fxGrad') // ondas
    expect(shader.vertexShader).toContain('vFxPos = position')
  })

  it('cada material de la fuente tiene su propia clave de programa', () => {
    const { root, materials } = fakeFountain(['AguaFuente', 'ChorroFuente', 'PiedraFuente', 'PiedraClara'])
    dressFountain(root)
    const keys = [...materials.values()].map((m) => m.customProgramCacheKey())
    // cada parche cabe en el shader real de three.js: no queda ningún include sin sustituir y todo se declara antes de usarse
    for (const material of materials.values()) {
      const shader = compile(material)
      expect(usedBeforeDeclared(shader.fragmentShader)).toEqual([])
    }
    expect(new Set(keys).size).toBe(3) // las dos piedras comparten shader
  })

  it('el tiempo, el cielo y la luz del día llegan a todos los materiales', () => {
    const { root, materials } = fakeFountain(['AguaFuente', 'ChorroFuente', 'PiedraFuente'])
    const water = dressFountain(root)!
    const shaders = [...materials.values()].map(compile)
    const sky = new THREE.Color(0x102030)
    water.update(12.5, sky, 0.25)
    for (const shader of shaders) {
      expect(shader.uniforms.uFxTime.value).toBe(12.5)
      expect((shader.uniforms.uFxSky.value as THREE.Color).getHex()).toBe(sky.getHex())
      expect(shader.uniforms.uFxDay.value).toBe(0.25)
    }
  })

  it('el cielo se copia: cambiarlo después no cambia lo que refleja', () => {
    const { root, materials } = fakeFountain(['AguaFuente'])
    const water = dressFountain(root)!
    const shader = compile(materials.get('AguaFuente')!)
    const sky = new THREE.Color(0x336699)
    water.update(0, sky, 1)
    sky.set(0xffffff)
    expect((shader.uniforms.uFxSky.value as THREE.Color).getHex()).toBe(0x336699)
  })

  it('la piedra se desgasta con humedad y manchas', () => {
    const { root, materials } = fakeFountain(['AguaFuente', 'PiedraFuente'])
    dressFountain(root)
    const shader = compile(materials.get('PiedraFuente')!)
    expect(shader.fragmentShader).toContain('fxWet')
    expect(shader.fragmentShader).toContain('roughnessFactor')
  })
})

describe('skipWaterShadows', () => {
  it('el agua y los chorros no dan sombra; la piedra sí', () => {
    const { root, materials } = fakeFountain(['AguaFuente', 'ChorroFuente', 'PiedraFuente', 'BronceFuente'])
    skipWaterShadows(root)
    const castShadow = (name: string) => (root.children.find((child) => (child as THREE.Mesh).material === materials.get(name)) as THREE.Mesh).castShadow
    expect(castShadow('AguaFuente')).toBe(false)
    expect(castShadow('ChorroFuente')).toBe(false)
    expect(castShadow('PiedraFuente')).toBe(true)
    expect(castShadow('BronceFuente')).toBe(true)
  })
})
